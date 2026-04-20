import { NextResponse } from 'next/server';
import { getState, hasRemoteStore } from '@/lib/server-state';

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = await getState();
  return NextResponse.json({ ...state, _kvConfigured: hasRemoteStore() });
}
