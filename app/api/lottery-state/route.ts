import { NextResponse } from 'next/server';
import { getState } from '@/lib/server-state';

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = await getState();
  const kvConfigured = Boolean(process.env.KV_REST_API_URL);
  const envNames = Object.keys(process.env)
    .filter(k => /^(KV|UPSTASH|REDIS)_/.test(k))
    .sort();
  return NextResponse.json({ ...state, _kvConfigured: kvConfigured, _envNames: envNames });
}
