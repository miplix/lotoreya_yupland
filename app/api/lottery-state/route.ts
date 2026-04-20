import { NextResponse } from 'next/server';
import { getState } from '@/lib/server-state';

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = await getState();
  const kvConfigured = Boolean(process.env.KV_REST_API_URL);
  return NextResponse.json({ ...state, _kvConfigured: kvConfigured });
}
