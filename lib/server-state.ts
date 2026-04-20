import { existsSync, readFileSync, writeFileSync } from 'fs';
import { RaffleResult, DrawState, ServerState } from './types';

const DEFAULT: ServerState = { history: [], latestDraw: null };
const REDIS_KEY = 'lottery:state';

// ── Redis (via REDIS_URL / KV_URL) — primary prod store ────────────────────
// Works with any Redis provider Vercel surfaces (Upstash, Redis.io, etc.).

type RedisClient = Awaited<ReturnType<typeof makeRedisClient>> | null;

declare global {
  // eslint-disable-next-line no-var
  var __redisClient: RedisClient | undefined;
  // eslint-disable-next-line no-var
  var __lotteryCache: ServerState | undefined;
}

async function makeRedisClient(url: string) {
  const { createClient } = await import('redis');
  const client = createClient({
    url,
    socket: { reconnectStrategy: (r) => Math.min(r * 50, 2000) },
  });
  client.on('error', (e) => console.error('[redis]', e));
  await client.connect();
  return client;
}

async function getRedis() {
  const url = process.env.REDIS_URL || process.env.KV_URL;
  if (!url) return null;
  if (global.__redisClient && global.__redisClient.isReady) return global.__redisClient;
  try {
    global.__redisClient = await makeRedisClient(url);
    return global.__redisClient;
  } catch (e) {
    console.error('[redis connect failed]', e);
    return null;
  }
}

async function redisGet(): Promise<ServerState | null> {
  const client = await getRedis();
  if (!client) return null;
  try {
    const raw = await client.get(REDIS_KEY);
    return raw ? (JSON.parse(raw) as ServerState) : null;
  } catch (e) {
    console.error('[redisGet]', e);
    return null;
  }
}

async function redisSet(state: ServerState): Promise<boolean> {
  const client = await getRedis();
  if (!client) return false;
  try {
    await client.set(REDIS_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.error('[redisSet]', e);
    return false;
  }
}

// ── Legacy Vercel KV REST (KV_REST_API_URL/TOKEN) ──────────────────────────

async function kvGet(): Promise<ServerState | null> {
  if (!process.env.KV_REST_API_URL) return null;
  try {
    const { kv } = await import('@vercel/kv');
    return await kv.get<ServerState>(REDIS_KEY);
  } catch { return null; }
}

async function kvSet(state: ServerState): Promise<boolean> {
  if (!process.env.KV_REST_API_URL) return false;
  try {
    const { kv } = await import('@vercel/kv');
    await kv.set(REDIS_KEY, state);
    return true;
  } catch { return false; }
}

// ── Local fallback (single-process dev without any remote store) ───────────

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

export function hasRemoteStore(): boolean {
  return Boolean(process.env.REDIS_URL || process.env.KV_URL || process.env.KV_REST_API_URL);
}

export async function getState(): Promise<ServerState> {
  if (process.env.REDIS_URL || process.env.KV_URL) {
    return (await redisGet()) ?? { ...DEFAULT };
  }
  if (process.env.KV_REST_API_URL) {
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

  if (process.env.REDIS_URL || process.env.KV_URL) {
    await redisSet(s);
  } else if (process.env.KV_REST_API_URL) {
    await kvSet(s);
  } else {
    localSet(s);
  }
}
