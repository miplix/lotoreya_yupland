import { NextRequest, NextResponse } from 'next/server';
import { turso } from '@/lib/turso';

export const dynamic = 'force-dynamic';

const DEFAULT_CONTRACT = process.env.NFT_CONTRACT_ADDRESS ?? 'yuplandshop.mintbase1.near';

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
  const contract = request.nextUrl.searchParams.get('contract') ?? DEFAULT_CONTRACT;
  const limitRaw = parseInt(request.nextUrl.searchParams.get('limit') ?? '50', 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;

  try {
    const client = turso();
    const args: (string | number)[] = [contract];
    let where = 'contract_id = ?';
    if (q.length > 0) {
      where += ' AND lower(title) LIKE ?';
      args.push(`%${q.toLowerCase()}%`);
    }
    args.push(limit);
    const result = await client.execute({
      sql: `SELECT title, image, count FROM collection_titles WHERE ${where} ORDER BY count DESC, title ASC LIMIT ?`,
      args,
    });
    const items = result.rows.map(r => ({
      title: r.title as string,
      image: (r.image as string | null) ?? null,
      count: Number(r.count ?? 0),
    }));
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error', items: [] },
      { status: 500 },
    );
  }
}
