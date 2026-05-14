// Client-side payout engine for /watch and the main lottery page.
// Constants and Mintbase tx shape mirror sendler-alchemy-balances/shop.html
// so behaviour is consistent across the two services.

import type { Winner, Prize } from './types';
import { resolveImage } from './image';

export const SIGNER_WALLET = 'darai_collection.near';
export const NFT_CONTRACT = 'yuplandshop.mintbase1.near';

const ROYALTY_PERCENT = 500; // 5% in basis points (Mintbase convention)
const MINT_DEPOSIT_PER = 9_870_000_000_000_000_000_000n; // yocto per mint
const TRANSFER_GAS = '200000000000000'; // 200 TGas
const TX_GAS_BUDGET = 280_000_000_000_000; // hard cap per NEAR TX
const STORAGE_DEPOSIT_AMOUNT = '1250000000000000000000'; // 0.00125 NEAR
const STORAGE_DEPOSIT_GAS = '10000000000000'; // 10 TGas
const FT_TRANSFER_GAS = '30000000000000'; // 30 TGas

export interface WinnerAgg {
  wallet: string;
  count: number; // how many prize units to deliver (already aggregated in Winner.prizeCount)
}

export interface NftTemplate {
  title: string;
  description: string;
  media: string;
  reputation: number;
}

export interface NftPlanItem {
  wallet: string;
  needed: number;          // total to deliver
  transferTokenIds: string[]; // existing in SIGNER_WALLET; subset taken from holdings
  mintCount: number;       // remainder to mint
}

export interface FtPlanItem {
  wallet: string;
  rawAmount: string;       // BigInt as string (humanAmount × 10^decimals × count)
}

export interface NearAction {
  type: 'FunctionCall';
  params: {
    methodName: string;
    args: Record<string, unknown>;
    gas: string;
    deposit: string;
  };
}

export interface NearTransaction {
  receiverId: string;
  actions: NearAction[];
}

// ───── Aggregation ─────────────────────────────────────────────────────────

export function aggregateWinners(winners: Winner[]): WinnerAgg[] {
  // Winner.prizeCount already collapses repeat wins for a single wallet.
  // Re-bucket defensively in case upstream changes.
  const map = new Map<string, number>();
  for (const w of winners) {
    map.set(w.wallet, (map.get(w.wallet) ?? 0) + w.prizeCount);
  }
  return Array.from(map.entries()).map(([wallet, count]) => ({ wallet, count }));
}

// ───── NFT plan ────────────────────────────────────────────────────────────

interface PlanNftArgs {
  prize: Prize;
  winners: WinnerAgg[];
  signerHoldings: string[]; // token_ids of SIGNER_WALLET for the prize title
  mintable: boolean;        // false when the title doesn't belong to NFT_CONTRACT
}

export interface NftPayoutPlan {
  prize: Prize;
  items: NftPlanItem[];
  totalTransfer: number;
  totalMint: number;
  unmintableShortfall: number; // winners that can't be served on-chain (no holdings, not mintable)
  mintable: boolean;
}

export function planNftPayout({ prize, winners, signerHoldings, mintable }: PlanNftArgs): NftPayoutPlan {
  const pool = [...signerHoldings];
  let totalTransfer = 0;
  let totalMint = 0;
  let unmintableShortfall = 0;
  const items: NftPlanItem[] = [];

  for (const w of winners) {
    const take = Math.min(w.count, pool.length);
    const transferTokenIds = pool.splice(0, take);
    const remainder = w.count - transferTokenIds.length;
    const mintCount = mintable ? remainder : 0;
    if (!mintable) unmintableShortfall += remainder;
    totalTransfer += transferTokenIds.length;
    totalMint += mintCount;
    items.push({ wallet: w.wallet, needed: w.count, transferTokenIds, mintCount });
  }
  return { prize, items, totalTransfer, totalMint, unmintableShortfall, mintable };
}

export function buildNftMintAction(template: NftTemplate, ownerId: string, num: number): NearAction {
  // Mintbase returns the unused storage; 5% overpay is the convention.
  const deposit = ((MINT_DEPOSIT_PER * BigInt(num) * 105n) / 100n).toString();
  // Gas budget: 50 TGas base + 2 TGas per mint, clamped to [100, 280].
  const gasN = Math.min(280, Math.max(100, 50 + 2 * num)) * 1e12;
  const gas = BigInt(Math.round(gasN)).toString();
  return {
    type: 'FunctionCall',
    params: {
      methodName: 'nft_batch_mint',
      args: {
        owner_id: ownerId,
        metadata: {
          title: template.title,
          description: template.description || '',
          media: template.media,
          extra: JSON.stringify({ Reputation: Number(template.reputation || 0) }),
        },
        num_to_mint: num,
        royalty_args: {
          split_between: { [SIGNER_WALLET]: 10000 },
          percentage: ROYALTY_PERCENT,
        },
        split_owners: null,
      },
      gas,
      deposit,
    },
  };
}

export function buildNftBatchTransferAction(pairs: Array<[string, string]>): NearAction {
  // pairs: [[token_id, receiver_id], …]
  return {
    type: 'FunctionCall',
    params: {
      methodName: 'nft_batch_transfer',
      args: { token_ids: pairs },
      gas: TRANSFER_GAS,
      deposit: '1',
    },
  };
}

// ───── FT plan ─────────────────────────────────────────────────────────────

interface PlanFtArgs {
  prize: Prize;
  winners: WinnerAgg[];
  decimals: number;
}

export interface FtPayoutPlan {
  prize: Prize;
  ftContract: string;
  decimals: number;
  items: FtPlanItem[];
}

export function planFtPayout({ prize, winners, decimals }: PlanFtArgs & { ftContract?: string }): FtPayoutPlan {
  const perWinner = prize.tokenAmount ?? 0;
  const items: FtPlanItem[] = winners.map(w => {
    const human = perWinner * w.count;
    const raw = humanToRaw(human, decimals);
    return { wallet: w.wallet, rawAmount: raw };
  });
  return { prize, ftContract: '', decimals, items };
}

function humanToRaw(human: number, decimals: number): string {
  if (decimals === 0) return Math.round(human).toString();
  // Avoid float drift by splitting integer + fractional.
  const s = human.toString();
  const [intPart, fracPart = ''] = s.split('.');
  const fracPadded = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  const combined = (intPart || '0') + fracPadded;
  // Strip leading zeros and avoid "" / "0…".
  return BigInt(combined).toString();
}

export function buildFtStorageDepositAction(receiverId: string): NearAction {
  return {
    type: 'FunctionCall',
    params: {
      methodName: 'storage_deposit',
      args: { account_id: receiverId, registration_only: true },
      gas: STORAGE_DEPOSIT_GAS,
      deposit: STORAGE_DEPOSIT_AMOUNT,
    },
  };
}

export function buildFtTransferAction(receiverId: string, rawAmount: string): NearAction {
  return {
    type: 'FunctionCall',
    params: {
      methodName: 'ft_transfer',
      args: { receiver_id: receiverId, amount: rawAmount, memo: 'lottery payout' },
      gas: FT_TRANSFER_GAS,
      deposit: '1',
    },
  };
}

// ───── TX splitter (same algorithm as shop.html) ───────────────────────────

export function splitTxs(actions: NearAction[], receiverId: string): NearTransaction[] {
  const txs: NearTransaction[] = [];
  let cur: NearAction[] = [];
  let curGas = 0;
  for (const a of actions) {
    const g = parseInt(a.params.gas, 10);
    if (cur.length && curGas + g > TX_GAS_BUDGET) {
      txs.push({ receiverId, actions: cur });
      cur = [];
      curGas = 0;
    }
    cur.push(a);
    curGas += g;
  }
  if (cur.length) txs.push({ receiverId, actions: cur });
  return txs;
}

// ───── Photo payload for the TG notification step ──────────────────────────

export function nftPhotoUrl(template: NftTemplate | null, fallbackMedia?: string | null): string {
  return resolveImage(template?.media ?? fallbackMedia ?? '');
}
