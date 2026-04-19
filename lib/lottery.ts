import { NFTQuery, Prize, Winner, RaffleResult } from './types';

interface WalletRange {
  wallet: string;
  start: number;
  end: number;
}

// Deduplicates by token_id to avoid double-counting if a query overlaps another
export function aggregateWalletTickets(queries: NFTQuery[]): Map<string, number> {
  const seen = new Set<string>();
  const map = new Map<string, number>();
  for (const q of queries) {
    for (const nft of q.nfts) {
      if (seen.has(nft.token_id)) continue;
      seen.add(nft.token_id);
      map.set(nft.owner_id, (map.get(nft.owner_id) ?? 0) + nft.tickets);
    }
  }
  return map;
}

export function getTotalTickets(queries: NFTQuery[]): number {
  return Array.from(aggregateWalletTickets(queries).values()).reduce((s, v) => s + v, 0);
}

function buildRanges(ticketMap: Map<string, number>): { ranges: WalletRange[]; total: number } {
  const ranges: WalletRange[] = [];
  let cursor = 1;
  for (const [wallet, tickets] of ticketMap) {
    ranges.push({ wallet, start: cursor, end: cursor + tickets - 1 });
    cursor += tickets;
  }
  return { ranges, total: cursor - 1 };
}

function pickUnique(count: number, max: number): number[] {
  // Fisher-Yates partial shuffle for large pick ratios, simple rejection sampling otherwise
  if (count > max * 0.5) {
    const pool = Array.from({ length: max }, (_, i) => i + 1);
    for (let i = pool.length - 1; i >= pool.length - count; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(pool.length - count).sort((a, b) => a - b);
  }
  const set = new Set<number>();
  while (set.size < count) {
    set.add(Math.floor(Math.random() * max) + 1);
  }
  return Array.from(set).sort((a, b) => a - b);
}

function walletForNumber(num: number, ranges: WalletRange[]): string {
  let lo = 0, hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (num < ranges[mid].start) hi = mid - 1;
    else if (num > ranges[mid].end) lo = mid + 1;
    else return ranges[mid].wallet;
  }
  return 'unknown';
}

export function runLottery(
  queries: NFTQuery[],
  prizes: Prize[],
): { result: RaffleResult; capped: boolean } {
  const ticketMap = aggregateWalletTickets(queries);
  const { ranges, total } = buildRanges(ticketMap);

  const totalPrizes = prizes.reduce((s, p) => s + p.count, 0);
  const capped = totalPrizes > total;
  const drawCount = Math.min(totalPrizes, total);

  const drawn = pickUnique(drawCount, total);

  const walletWins = new Map<string, number[]>();
  for (const num of drawn) {
    const wallet = walletForNumber(num, ranges);
    const arr = walletWins.get(wallet) ?? [];
    arr.push(num);
    walletWins.set(wallet, arr);
  }

  const winners: Winner[] = [];
  for (const [wallet, nums] of walletWins) {
    winners.push({ wallet, winningNumbers: nums, prizeCount: nums.length });
  }
  winners.sort((a, b) => b.prizeCount - a.prizeCount);

  return {
    result: {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      prizes,
      winners,
      totalTickets: total,
      csvData: winners.map(w => ({ wallet: w.wallet, count: w.prizeCount })),
    },
    capped,
  };
}
