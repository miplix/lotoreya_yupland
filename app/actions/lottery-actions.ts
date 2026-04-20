'use server';

import { patchState } from '@/lib/server-state';
import { DrawState, RaffleResult } from '@/lib/types';

export async function pushLotteryResult(data: {
  latestDraw: DrawState;
  history: RaffleResult[];
}): Promise<void> {
  await patchState(data);
}
