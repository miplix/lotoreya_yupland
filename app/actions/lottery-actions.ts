'use server';

import { patchState, clearState } from '@/lib/server-state';
import { DrawState, RaffleResult } from '@/lib/types';

export async function pushLotteryResult(data: {
  latestDraw: DrawState;
  history: RaffleResult[];
}): Promise<void> {
  await patchState(data);
}

export async function clearLotteryState(): Promise<void> {
  await clearState();
}
