// БД-адаптер. Был libsql/Turso → стал Supabase (схема yuplink).
// Интерфейс execute({sql, args}) полностью совпадает с libsql-клиентом,
// поэтому остальной код (app/api/*) НЕ меняется.
//
// Под капотом — pattern-matching по SQL-строкам. У нас всего 8 запросов,
// перечислены в switch ниже. Если добавится новый — расширить здесь.

import { createClient } from '@supabase/supabase-js';

type SB = ReturnType<typeof createClient<any, 'yuplink'>>; // eslint-disable-line @typescript-eslint/no-explicit-any

declare global {
  // eslint-disable-next-line no-var
  var __supabase: SB | undefined;
}

function sb(): SB {
  if (global.__supabase) return global.__supabase;
  const url = process.env.SUPABASE_URL;
  // Можно использовать service_role (обходит RLS) или anon (нужны RLS-политики).
  // На лотерее живёт anon — golden-drop держит service_role у себя.
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL / (SUPABASE_SERVICE_ROLE_KEY | SUPABASE_ANON_KEY) not set',
    );
  }
  global.__supabase = createClient<any, 'yuplink'>(url, key, { // eslint-disable-line @typescript-eslint/no-explicit-any
    db: { schema: 'yuplink' },
    auth: { persistSession: false },
  });
  return global.__supabase;
}

export interface ExecuteResult {
  rows: Record<string, unknown>[];
  rowsAffected?: number;
}

// Минимально-совместимый клиент: только execute({sql, args}) и close().
class CompatClient {
  async execute(query: {
    sql: string;
    args?: (string | number | null)[];
  }): Promise<ExecuteResult> {
    const sql = query.sql.replace(/\s+/g, ' ').trim();
    const args = query.args ?? [];

    // 1. SELECT title, image, count FROM collection_titles WHERE contract_id = ? AND lower(title) LIKE ? ORDER BY count DESC LIMIT ?
    //    (LIKE-часть опциональна — есть и без неё)
    if (
      sql.startsWith(
        'SELECT title, image, count FROM collection_titles WHERE contract_id = ?',
      )
    ) {
      const hasLike = sql.includes('lower(title) LIKE ?');
      let q = sb()
        .from('collection_titles')
        .select('title, image, count')
        .eq('contract_id', String(args[0]));
      if (hasLike) {
        // libsql: lower(title) LIKE '%foo%' (передаётся уже lowercased+%-wrap).
        // PostgREST ilike не требует lower() — он сам case-insensitive.
        const raw = String(args[1]);
        // raw уже вида "%foo%"; ilike хочет тот же формат.
        q = q.ilike('title', raw);
      }
      const limit = Number(args[args.length - 1]);
      const { data, error } = await q
        .order('count', { ascending: false })
        .order('title', { ascending: true })
        .limit(limit);
      if (error) throw new Error(`Supabase: ${error.message}`);
      return { rows: (data ?? []) as Record<string, unknown>[] };
    }

    // 2. SELECT count(*) AS c FROM collection_titles WHERE contract_id = ?
    if (sql === 'SELECT count(*) AS c FROM collection_titles WHERE contract_id = ?') {
      const { count, error } = await sb()
        .from('collection_titles')
        .select('id', { count: 'exact', head: true })
        .eq('contract_id', String(args[0]));
      if (error) throw new Error(`Supabase: ${error.message}`);
      return { rows: [{ c: count ?? 0 }] };
    }

    // 3. SELECT contract_id, last_skip, total_seen, last_scanned_at FROM scan_state WHERE contract_id = ?
    if (
      sql ===
      'SELECT contract_id, last_skip, total_seen, last_scanned_at FROM scan_state WHERE contract_id = ?'
    ) {
      const { data, error } = await sb()
        .from('scan_state')
        .select('contract_id, last_skip, total_seen, last_scanned_at')
        .eq('contract_id', String(args[0]))
        .maybeSingle();
      if (error) throw new Error(`Supabase: ${error.message}`);
      return { rows: data ? [data as Record<string, unknown>] : [] };
    }

    // 4. SELECT last_skip, total_seen FROM scan_state WHERE contract_id = ?
    if (sql === 'SELECT last_skip, total_seen FROM scan_state WHERE contract_id = ?') {
      const { data, error } = await sb()
        .from('scan_state')
        .select('last_skip, total_seen')
        .eq('contract_id', String(args[0]))
        .maybeSingle();
      if (error) throw new Error(`Supabase: ${error.message}`);
      return { rows: data ? [data as Record<string, unknown>] : [] };
    }

    // 5. INSERT INTO scan_state (contract_id, last_skip, total_seen) VALUES (?, 0, 0)
    if (
      sql === 'INSERT INTO scan_state (contract_id, last_skip, total_seen) VALUES (?, 0, 0)'
    ) {
      const { error } = await sb()
        .from('scan_state')
        .insert({ contract_id: String(args[0]), last_skip: 0, total_seen: 0 });
      if (error) throw new Error(`Supabase: ${error.message}`);
      return { rows: [], rowsAffected: 1 };
    }

    // 6. Batch upsert in collection_titles. SQL:
    //    INSERT INTO collection_titles (id, contract_id, title, image, count)
    //    VALUES (?,?,?,?,?), (?,?,?,?,?), ...
    //    ON CONFLICT(id) DO UPDATE SET count = collection_titles.count + excluded.count, ...
    if (sql.startsWith('INSERT INTO collection_titles (id, contract_id, title, image, count) VALUES')) {
      // args — flat-список по 5 на ряд: [id, contract_id, title, image, count, ...]
      const rows: Array<{
        id: string;
        contract_id: string;
        title: string;
        image: string;
        count: number;
        scanned_at: string;
      }> = [];
      for (let i = 0; i < args.length; i += 5) {
        rows.push({
          id: String(args[i]),
          contract_id: String(args[i + 1]),
          title: String(args[i + 2]),
          image: String(args[i + 3] ?? ''),
          count: Number(args[i + 4]),
          scanned_at: new Date().toISOString(),
        });
      }
      // ВАЖНО: на таблице есть case-insensitive уникальный констрейнт
      // (collection_titles_unique по (contract_id, lower(title))). id скан строит
      // из сырого title, поэтому два титула-варианта регистра (или новый титул,
      // совпадающий по lower с существующим под другим id) ломали ВЕСЬ батч
      // (duplicate key) и свежие NFT не попадали в БД. Поэтому:
      //  1) дедуп батча по lower(title),
      //  2) матчим существующие строки по lower(title) и берём их РЕАЛЬНЫЙ id,
      //  3) существующие — UPDATE (count += ) по их id, новые — INSERT.
      const contract = rows[0]?.contract_id ?? '';
      const byKey = new Map<string, { title: string; image: string; count: number }>();
      for (const r of rows) {
        const k = r.title.toLowerCase();
        const cur = byKey.get(k);
        if (cur) {
          cur.count += r.count;
          if ((!cur.image || !cur.image.trim()) && r.image) cur.image = r.image;
        } else {
          byKey.set(k, { title: r.title, image: r.image, count: r.count });
        }
      }
      const { data: existing, error: selErr } = await sb()
        .from('collection_titles')
        .select('id, title, count, image')
        .eq('contract_id', contract)
        .limit(100000);
      if (selErr) throw new Error(`Supabase: ${selErr.message}`);
      const exByLower = new Map<string, { id: string; count: number; image: string | null }>();
      for (const e of (existing ?? []) as Array<{ id: string; title: string; count: number; image: string | null }>) {
        exByLower.set((e.title ?? '').toLowerCase(), { id: e.id, count: e.count, image: e.image });
      }
      const now = new Date().toISOString();
      const updates: Array<Record<string, unknown>> = [];
      const inserts: Array<Record<string, unknown>> = [];
      for (const [k, b] of byKey) {
        const ex = exByLower.get(k);
        if (ex) {
          updates.push({
            id: ex.id, contract_id: contract, title: b.title,
            image: ex.image && ex.image.trim().length > 0 ? ex.image : b.image,
            count: ex.count + b.count, scanned_at: now,
          });
        } else {
          inserts.push({
            id: `${contract}:${b.title}`, contract_id: contract, title: b.title,
            image: b.image || '', count: b.count, scanned_at: now,
          });
        }
      }
      if (updates.length) {
        const { error } = await sb().from('collection_titles').upsert(updates, { onConflict: 'id' });
        if (error) throw new Error(`Supabase upd: ${error.message}`);
      }
      if (inserts.length) {
        const { error } = await sb().from('collection_titles').insert(inserts);
        if (error) throw new Error(`Supabase ins: ${error.message}`);
      }
      return { rows: [], rowsAffected: updates.length + inserts.length };
    }

    // 7. UPDATE scan_state SET last_skip = ?, total_seen = ?, last_scanned_at = ? WHERE contract_id = ?
    if (
      sql ===
      'UPDATE scan_state SET last_skip = ?, total_seen = ?, last_scanned_at = ? WHERE contract_id = ?'
    ) {
      const { error } = await sb()
        .from('scan_state')
        .update({
          last_skip: Number(args[0]),
          total_seen: Number(args[1]),
          last_scanned_at: String(args[2]),
        })
        .eq('contract_id', String(args[3]));
      if (error) throw new Error(`Supabase: ${error.message}`);
      return { rows: [], rowsAffected: 1 };
    }

    // 8. SELECT symbol, ft_contract, decimals, sort_order FROM reward_tokens ORDER BY sort_order ASC, symbol ASC
    if (
      sql === 'SELECT symbol, ft_contract, decimals, sort_order FROM reward_tokens ORDER BY sort_order ASC, symbol ASC'
    ) {
      const { data, error } = await sb()
        .from('reward_tokens')
        .select('symbol, ft_contract, decimals, sort_order')
        .order('sort_order', { ascending: true })
        .order('symbol', { ascending: true });
      if (error) throw new Error(`Supabase: ${error.message}`);
      return { rows: (data ?? []) as Record<string, unknown>[] };
    }

    throw new Error(`turso() execute: непокрытый SQL-паттерн: ${sql}`);
  }

  close(): void {
    /* no-op */
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __turso: CompatClient | undefined;
}

export function turso(): CompatClient {
  if (global.__turso) return global.__turso;
  global.__turso = new CompatClient();
  return global.__turso;
}
