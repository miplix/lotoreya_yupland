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
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set');
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
      // ON CONFLICT-логика "count += excluded.count" не выражается одним upsert,
      // поэтому делаем select+merge+upsert вручную.
      const ids = rows.map((r) => r.id);
      const { data: existing, error: selErr } = await sb()
        .from('collection_titles')
        .select('id, count, image')
        .in('id', ids);
      if (selErr) throw new Error(`Supabase: ${selErr.message}`);
      const existingMap = new Map<string, { count: number; image: string | null }>();
      for (const r of (existing ?? []) as Array<{ id: string; count: number; image: string | null }>) {
        existingMap.set(r.id, { count: r.count, image: r.image });
      }
      const merged = rows.map((r) => {
        const prev = existingMap.get(r.id);
        return {
          ...r,
          count: (prev?.count ?? 0) + r.count,
          // image: оставляем старое, если оно непустое, иначе берём новое.
          image: prev?.image && prev.image.trim().length > 0 ? prev.image : r.image,
        };
      });
      const { error: upErr } = await sb()
        .from('collection_titles')
        .upsert(merged, { onConflict: 'id' });
      if (upErr) throw new Error(`Supabase: ${upErr.message}`);
      return { rows: [], rowsAffected: merged.length };
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
