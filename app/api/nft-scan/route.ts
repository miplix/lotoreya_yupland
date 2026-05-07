import { NextRequest, NextResponse } from 'next/server';
import { turso } from '@/lib/turso';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SENDLER_API_BASE = 'https://api.sendler.xyz/nft/';
const DEFAULT_CONTRACT = process.env.NFT_CONTRACT_ADDRESS ?? 'yuplandshop.mintbase1.near';
const BATCH = 5000;

interface SendlerItem { token_id: string; title?: string; media?: string; }

async function fetchSendlerPage(contract: string, skip: number): Promise<SendlerItem[]> {
  const apiKey = process.env.NFT_API_KEY;
  if (!apiKey) throw new Error('NFT_API_KEY is not set');
  const url = new URL(SENDLER_API_BASE);
  url.searchParams.set('contract_address', contract);
  url.searchParams.set('skip', String(skip));
  url.searchParams.set('limit', String(BATCH));
  const res = await fetch(url.toString(), {
    headers: { accept: 'application/json', 'X-API-Key': apiKey },
  });
  if (!res.ok) throw new Error(`Sendler ${res.status}`);
  const json = (await res.json()) as { items?: SendlerItem[] };
  return (json.items ?? []).filter(x => !!x.token_id);
}

export async function GET() {
  const client = turso();
  const r = await client.execute({
    sql: 'SELECT contract_id, last_skip, total_seen, last_scanned_at FROM scan_state WHERE contract_id = ?',
    args: [DEFAULT_CONTRACT],
  });
  const row = r.rows[0];
  const titlesRow = await client.execute({
    sql: 'SELECT count(*) AS c FROM collection_titles WHERE contract_id = ?',
    args: [DEFAULT_CONTRACT],
  });
  return NextResponse.json({
    contractId: DEFAULT_CONTRACT,
    lastSkip: Number(row?.last_skip ?? 0),
    totalSeen: Number(row?.total_seen ?? 0),
    lastScannedAt: (row?.last_scanned_at as string | null) ?? null,
    uniqueTitles: Number(titlesRow.rows[0]?.c ?? 0),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const pages = Math.max(1, Math.min(10, Number(body?.pages ?? 5)));
  const resume = body?.resume !== false;
  const contract = (body?.contract as string) ?? DEFAULT_CONTRACT;
  const client = turso();

  const stateRes = await client.execute({
    sql: 'SELECT last_skip, total_seen FROM scan_state WHERE contract_id = ?',
    args: [contract],
  });
  let startSkip = 0;
  let totalSeen = 0;
  if (stateRes.rows[0]) {
    startSkip = resume ? Number(stateRes.rows[0].last_skip ?? 0) : 0;
    totalSeen = resume ? Number(stateRes.rows[0].total_seen ?? 0) : 0;
  } else {
    await client.execute({
      sql: 'INSERT INTO scan_state (contract_id, last_skip, total_seen) VALUES (?, 0, 0)',
      args: [contract],
    });
  }

  const offsets = Array.from({ length: pages }, (_, i) => startSkip + i * BATCH);
  const fetched = await Promise.all(offsets.map(s => fetchSendlerPage(contract, s)));

  const grouped = new Map<string, { title: string; image: string; count: number }>();
  let itemsThisRun = 0;
  let endOfCollection = false;
  for (const items of fetched) {
    itemsThisRun += items.length;
    if (items.length < BATCH) endOfCollection = true;
    for (const it of items) {
      const t = (it.title ?? '').trim();
      if (!t) continue;
      const cur = grouped.get(t);
      if (cur) cur.count++;
      else grouped.set(t, { title: t, image: it.media ?? '', count: 1 });
    }
  }

  if (grouped.size > 0) {
    const rows = Array.from(grouped.values());
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?)').join(', ');
      const args: (string | number)[] = [];
      for (const g of chunk) {
        args.push(`${contract}:${g.title}`, contract, g.title, g.image || '', g.count);
      }
      await client.execute({
        sql: `INSERT INTO collection_titles (id, contract_id, title, image, count) VALUES ${placeholders}
              ON CONFLICT(id) DO UPDATE SET
                count = collection_titles.count + excluded.count,
                image = COALESCE(NULLIF(collection_titles.image, ''), excluded.image),
                scanned_at = CURRENT_TIMESTAMP`,
        args,
      });
    }
  }

  totalSeen += itemsThisRun;
  const newSkip = startSkip + itemsThisRun;
  await client.execute({
    sql: `UPDATE scan_state SET last_skip = ?, total_seen = ?, last_scanned_at = ? WHERE contract_id = ?`,
    args: [newSkip, totalSeen, new Date().toISOString(), contract],
  });

  return NextResponse.json({
    contractId: contract,
    pagesDone: fetched.length,
    itemsThisRun,
    titlesAddedOrUpdated: grouped.size,
    lastSkip: newSkip,
    totalSeen,
    endOfCollection,
  });
}
