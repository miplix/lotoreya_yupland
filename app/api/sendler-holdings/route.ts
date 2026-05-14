import { NextRequest, NextResponse } from 'next/server';

// Returns NFTs that `owner` holds with the given exact `title`. If `contract`
// is passed we narrow to that collection; otherwise we look across all of
// `owner`'s NFTs and return the contract the matching tokens belong to.
//
// Used by the payout planner to (1) decide transfer vs mint, and (2) detect
// "foreign collection" titles (e.g. yupai.nfts.tg) — those are transfer-only.

const SENDLER_BASE = 'https://api.sendler.xyz/nft/';
const MINTBASE_CONTRACT = 'yuplandshop.mintbase1.near';

interface SendlerItem {
  token_id: string;
  title?: string;
  owner_id?: string;
  media?: string;
  description?: string;
  reputation?: number;
  nft_contract_id?: string;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const owner = params.get('owner');
  const title = params.get('title');
  const contract = params.get('contract') ?? '';
  if (!owner || !title) {
    return NextResponse.json({ error: 'owner & title required' }, { status: 400 });
  }
  const apiKey = process.env.NFT_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'NFT_API_KEY missing' }, { status: 500 });
  }

  try {
    const url = new URL(SENDLER_BASE);
    if (contract) url.searchParams.set('contract_address', contract);
    url.searchParams.set('owner_id', owner);
    url.searchParams.set('title', title);
    url.searchParams.set('skip', '0');
    url.searchParams.set('limit', '5000');
    const res = await fetch(url.toString(), {
      headers: { accept: 'application/json', 'X-API-Key': apiKey },
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Sendler ${res.status}` }, { status: res.status });
    }
    const json = (await res.json()) as { items?: SendlerItem[] };
    const all = (json.items ?? []).filter(i => !!i.token_id);
    // Sendler's title parameter is fuzzy — keep only exact case-insensitive matches.
    const targetLower = title.toLowerCase();
    const matched = all.filter(i => (i.title ?? '').toLowerCase() === targetLower);
    // Resolve contract: prefer the one the matched tokens belong to.
    const detectedContract = matched[0]?.nft_contract_id ?? contract ?? '';
    const sample = matched[0] ?? null;
    return NextResponse.json({
      contract: detectedContract,
      mintable: detectedContract === MINTBASE_CONTRACT, // only this collection accepts nft_batch_mint from us
      title,
      owner,
      tokenIds: matched.map(i => String(i.token_id)),
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
