import { NextResponse } from 'next/server';
import { turso } from '@/lib/turso';

// Reads the shared reward_tokens registry from Turso (same row golden-drop maintains).
export async function GET() {
  try {
    const client = turso();
    const result = await client.execute({
      sql: `SELECT symbol, ft_contract, decimals, sort_order
            FROM reward_tokens
            ORDER BY sort_order ASC, symbol ASC`,
      args: [],
    });
    const items = result.rows.map(r => ({
      symbol: r.symbol as string,
      ftContract: r.ft_contract as string,
      decimals: Number(r.decimals ?? 0),
      sortOrder: Number(r.sort_order ?? 0),
    }));
    return NextResponse.json(
      { items },
      { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown', items: [] },
      { status: 500 },
    );
  }
}
