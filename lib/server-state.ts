import { RaffleResult, DrawState, ServerState } from './types';

const DEFAULT: ServerState = { history: [], latestDraw: null };

// Module-level cache via globalThis — persists within a single Node.js/Lambda instance.
// Works reliably for low-traffic deployments (single warm Vercel instance).
declare global { var __lotteryState: ServerState | undefined; }
if (!global.__lotteryState) global.__lotteryState = { ...DEFAULT };

export function getState(): ServerState {
  return global.__lotteryState!;
}

export function patchState(data: { history?: RaffleResult[]; latestDraw?: DrawState | null }): void {
  const s = global.__lotteryState!;
  if (data.history !== undefined) s.history = data.history;
  if ('latestDraw' in data) s.latestDraw = data.latestDraw ?? null;
}
