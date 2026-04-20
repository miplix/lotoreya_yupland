import { existsSync, readFileSync, writeFileSync } from 'fs';
import { RaffleResult, DrawState, ServerState } from './types';

const DEFAULT: ServerState = { history: [], latestDraw: null };

// ── KV (Vercel / Upstash Redis) ────────────────────────────────────────────
// Required env vars (auto-added by Vercel when you connect a KV database):
//   KV_REST_API_URL, KV_REST_API_TOKEN

async function kvGet(): Promise<ServerState | null> {
  if (!process.env.KV_REST_API_URL) return null;
  try {
    const { kv } = await import('@vercel/kv');
    return await kv.get<ServerState>('lottery:state');
  } catch { return null; }
}

async function kvSet(state: ServerState): Promise<void> {
  if (!process.env.KV_REST_API_URL) return;
  try {
    const { kv } = await import('@vercel/kv');
    await kv.set('lottery:state', state);
  } catch { /* ignore */ }
}

// ── Local fallback (single-process dev without KV) ─────────────────────────
declare global { var __lotteryCache: ServerState | undefined; }

function localGet(): ServerState | null {
  if (global.__lotteryCache) return global.__lotteryCache;
  try {
    if (existsSync('/tmp/lottery-state.json'))
      return JSON.parse(readFileSync('/tmp/lottery-state.json', 'utf8'));
  } catch { /* ignore */ }
  return null;
}

function localSet(state: ServerState): void {
  global.__lotteryCache = state;
  try { writeFileSync('/tmp/lottery-state.json', JSON.stringify(state)); } catch { /* ignore */ }
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function getState(): Promise<ServerState> {
  if (process.env.KV_REST_API_URL) {
    // Production: always read fresh from KV — no stale per-instance cache
    return (await kvGet()) ?? { ...DEFAULT };
  }
  return localGet() ?? { ...DEFAULT };
}

export async function patchState(data: {
  history?: RaffleResult[];
  latestDraw?: DrawState | null;
}): Promise<void> {
  const s = { ...(await getState()) };
  if (data.history !== undefined) s.history = data.history;
  if ('latestDraw' in data) s.latestDraw = data.latestDraw ?? null;

  if (process.env.KV_REST_API_URL) {
    await kvSet(s);
  } else {
    localSet(s);
  }
}
