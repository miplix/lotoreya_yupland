import { NextRequest, NextResponse } from 'next/server';

const API_BASE = 'https://api.sendler.xyz/nft/';
const CONTRACT = process.env.NFT_CONTRACT_ADDRESS ?? 'yuplandshop.mintbase1.near';
const API_KEY = process.env.NFT_API_KEY ?? '';

export async function GET(request: NextRequest) {
  const title = request.nextUrl.searchParams.get('title');
  if (!title) {
    return NextResponse.json({ error: 'title required' }, { status: 400 });
  }

  const url =
    `${API_BASE}?contract_address=${encodeURIComponent(CONTRACT)}` +
    `&title=${encodeURIComponent(title)}&skip=0&limit=1000`;

  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'X-API-Key': API_KEY },
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Upstream ${res.status}` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Fetch failed' }, { status: 500 });
  }
}
