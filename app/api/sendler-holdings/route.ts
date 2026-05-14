import { NextRequest, NextResponse } from 'next/server';

// Returns NFTs of `owner` on `contract` with the exact `title`. Used by the
// payout planner to decide how many to transfer vs mint.

const SENDLER_BASE = 'https://api.sendler.xyz/nft/';
const DEFAULT_CONTRACT = process.env.NFT_CONTRACT_ADDRESS ?? 'yuplandshop.mintbase1.near';

interface SendlerItem {
  token_id: string;
  title?: string;
  owner_id?: string;
  media?: string;
  description?: string;
  reputation?: number;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const owner = params.get('owner');
  const title = params.get('title');
  const contract = params.get('contract') ?? DEFAULT_CONTRACT;
  if (!owner || !title) {
    return NextResponse.json({ error: 'owner & title required' }, { status: 400 });
  }
  const apiKey = process.env.NFT_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'NFT_API_KEY missing' }, { status: 500 });
  }

  try {
    const url = new URL(SENDLER_BASE);
    url.searchParams.set('contract_address', contract);
    url.searchParams.set('owner_id', owner);
    url.searchParams.set('title', title);
    url.searchParams.set('skip', '0');
    url.searchParams.set('limit', '5000');
    const res = await fetch(url.toString(), {
      headers: { accept: 'application/json', 'X-API-Key': apiKey },
      // Treat list fast — Sendler items list is reasonably fresh on 10–60 s.
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Sendler ${res.status}` }, { status: res.status });
    }
    const json = (await res.json()) as { items?: SendlerItem[] };
    const all = (json.items ?? []).filter(i => !!i.token_id);
    // Some titles in Sendler aren't exact match on the query — filter strictly.
    const targetLower = title.toLowerCase();
    const tokens = all.filter(i => (i.title ?? '').toLowerCase() === targetLower);
    const sample = tokens[0] ?? all[0];
    return NextResponse.json({
      contract,
      title,
      owner,
      tokenIds: tokens.map(i => String(i.token_id)),
      template: sample
        ? {
            title: sample.title ?? title,
            description: sample.description ?? '',
            media: sample.media ?? '',
            reputation: Number(sample.reputation ?? 0),
          }
        : null,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown' }, { status: 500 });
  }
}
