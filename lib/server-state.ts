import { existsSync, readFileSync, writeFileSync } from 'fs';
import { RaffleResult, DrawState, ServerState } from './types';

const FILE = '/tmp/lottery-state.json';
const DEFAULT: ServerState = { history: [], latestDraw: null };

// Dual persistence: globalThis (fast, same-process) + /tmp file (survives module re-evaluation)
declare global { var __lotteryCache: ServerState | undefined; }

export function getState(): ServerState {
  if (global.__lotteryCache) return global.__lotteryCache;
  try {
    if (existsSync(FILE)) {
      const s = JSON.parse(readFileSync(FILE, 'utf8')) as ServerState;
      global.__lotteryCache = s;
      return s;
    }
  } catch { /* ignore */ }
  const fresh = { ...DEFAULT };
  global.__lotteryCache = fresh;
  return fresh;
}

export function patchState(data: { history?: RaffleResult[]; latestDraw?: DrawState | null }): void {
  const s = getState();
  if (data.history !== undefined) s.history = data.history;
  if ('latestDraw' in data) s.latestDraw = data.latestDraw ?? null;
  global.__lotteryCache = s;
  try { writeFileSync(FILE, JSON.stringify(s)); } catch { /* ignore */ }
}
