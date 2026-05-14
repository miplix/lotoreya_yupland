'use client';

// Prize-payout panel for the lottery operator (darai_collection.near).
//
// Steps when the user clicks "Выдать призы":
//   1. For an NFT prize — fetch how many such tokens the signer wallet
//      currently holds (Sendler), build the transfer/mint plan, and
//      submit it via the connected wallet (hot-connector). Mintbase
//      titles get nft_batch_mint + nft_batch_transfer; titles from
//      other contracts get only a TG photo without 👍.
//   2. For a token prize — fetch decimals from reward_tokens, schedule
//      storage_deposit + ft_transfer per winner.
//   3. Before signing, post a separate TG photo per winner with the
//      NFT picture and caption. Keep the message_id list.
//   4. After NEAR signAndSendTransactions resolves, reach out to
//      /api/tg-react to drop 👍 on every photo we delivered on-chain.

import { useEffect, useMemo, useState } from 'react';
import type { Prize, RaffleResult } from '@/lib/types';
import {
  NFT_CONTRACT,
  SIGNER_WALLET,
  aggregateWinners,
  planNftPayout,
  planFtPayout,
  buildNftBatchTransferAction,
  buildNftMintAction,
  buildFtStorageDepositAction,
  buildFtTransferAction,
  splitTxs,
  type NearAction,
  type NftTemplate,
  type NftPayoutPlan,
  type FtPayoutPlan,
  type WinnerAgg,
} from '@/lib/payout';
import { getNotifyTelegram } from '@/lib/notifications';

interface RewardToken { symbol: string; ftContract: string; decimals: number; sortOrder: number; }

interface Holdings { tokenIds: string[]; template: NftTemplate | null; }

interface Props {
  result: RaffleResult;
  walletAccount: string;
  walletObj: {
    signAndSendTransactions: (args: { transactions: Array<{ receiverId: string; actions: unknown[] }> }) => Promise<unknown>;
  } | null;
  onClose: () => void;
}

type Stage = 'idle' | 'planning' | 'notifying' | 'signing' | 'reacting' | 'done' | 'error';

interface DeliveryRecord { chatId: string; messageId: number; }
interface PhotoRecord { wallet: string; deliveries: DeliveryRecord[]; }

export default function PayoutPanel({ result, walletAccount, walletObj, onClose }: Props) {
  // Only the first prize is supported — that matches the current raffle flow.
  const prize: Prize = result.prizes[0];
  const aggregated: WinnerAgg[] = useMemo(() => aggregateWinners(result.winners), [result.winners]);

  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [nftPlan, setNftPlan] = useState<NftPayoutPlan | null>(null);
  const [ftPlan, setFtPlan] = useState<FtPayoutPlan | null>(null);
  const [tokenInfo, setTokenInfo] = useState<RewardToken | null>(null);
  const [holdings, setHoldings] = useState<Holdings | null>(null);
  const [mintable, setMintable] = useState(false);

  const isToken = prize.kind === 'token';
  const isCollectionSigner = walletAccount === SIGNER_WALLET;

  // Build the plan (no signatures yet)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStage('planning');
      setError(null);
      try {
        if (isToken) {
          const r = await fetch('/api/reward-tokens');
          const data = await r.json();
          const tk: RewardToken | undefined = (data.items ?? []).find(
            (t: RewardToken) => t.symbol === prize.name,
          );
          if (!tk) throw new Error(`Токен ${prize.name} не найден в reward_tokens`);
          if (cancelled) return;
          setTokenInfo(tk);
          setFtPlan(planFtPayout({ prize, winners: aggregated, decimals: tk.decimals }));
        } else {
          const r = await fetch(
            `/api/sendler-holdings?owner=${encodeURIComponent(SIGNER_WALLET)}&title=${encodeURIComponent(prize.name)}&contract=${encodeURIComponent(NFT_CONTRACT)}`,
          );
          if (!r.ok) throw new Error(`Sendler ${r.status}`);
          const data = (await r.json()) as Holdings;
          if (cancelled) return;
          setHoldings(data);
          // mintable = title belongs to our NFT_CONTRACT. If the title is
          // not from yuplandshop we won't have minter rights anyway.
          const ok = !!data.template; // any token returned ⇒ title exists on NFT_CONTRACT
          setMintable(ok);
          setNftPlan(planNftPayout({
            prize,
            winners: aggregated,
            signerHoldings: data.tokenIds,
            mintable: ok,
          }));
        }
        if (!cancelled) setStage('idle');
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStage('error');
      }
    })();
    return () => { cancelled = true; };
  }, [aggregated, prize, isToken]);

  const sendAdminMessages = async (): Promise<PhotoRecord[]> => {
    // Send one private text per winner to every admin. Plain text keeps the
    // chat readable; the 👍 lands on these messages after the on-chain TX.
    const records: PhotoRecord[] = [];
    const items = isToken ? (ftPlan?.items ?? []) : (nftPlan?.items ?? []);
    for (const item of items) {
      const text = isToken
        ? `<code>${escapeHtml(item.wallet)}</code> — ${(prize.tokenAmount ?? 0) * (aggregated.find(a => a.wallet === item.wallet)?.count ?? 0)} ${escapeHtml(prize.name)}`
        : `<code>${escapeHtml(item.wallet)}</code> — ${(item as { needed: number }).needed} шт · «${escapeHtml(prize.name)}»`;
      try {
        const r = await fetch('/api/tg-admin-msg', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        const data = await r.json();
        const deliveries: DeliveryRecord[] = (data.deliveries ?? [])
          .filter((d: { messageId: number | null }) => typeof d.messageId === 'number')
          .map((d: { chatId: string; messageId: number }) => ({ chatId: d.chatId, messageId: d.messageId }));
        records.push({ wallet: item.wallet, deliveries });
      } catch {
        records.push({ wallet: item.wallet, deliveries: [] });
      }
    }
    return records;
  };

  const placeReactions = async (records: PhotoRecord[]) => {
    // 👍 goes on every message whose wallet actually received a payout.
    // For NFT prizes from outside our collection we leave the message
    // unreacted to make the "couldn't mint" case visible at a glance.
    let succeededWallets: Set<string>;
    if (isToken) {
      succeededWallets = new Set((ftPlan?.items ?? []).map(i => i.wallet));
    } else {
      if (!nftPlan || !nftPlan.mintable) return;
      succeededWallets = new Set(
        nftPlan.items
          .filter(i => i.transferTokenIds.length > 0 || i.mintCount > 0)
          .map(i => i.wallet),
      );
    }
    const targets: DeliveryRecord[] = [];
    for (const r of records) {
      if (!succeededWallets.has(r.wallet)) continue;
      targets.push(...r.deliveries);
    }
    if (targets.length === 0) return;
    try {
      await fetch('/api/tg-react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets, emoji: '👍' }),
      });
    } catch { /* ignore — reactions are best-effort */ }
  };

  const doPayout = async () => {
    if (!walletObj) { setError('Кошелёк не подключён'); setStage('error'); return; }
    setError(null);
    try {
      // 1. Send a private text message to each admin for every winner.
      // Skip entirely when the operator opted out of Telegram notifications.
      const tgEnabled = getNotifyTelegram();
      setStage('notifying');
      const photoRecords = tgEnabled ? await sendAdminMessages() : [];

      // 2. Build NEAR actions
      setStage('signing');
      let actions: NearAction[] = [];
      let receiverId = '';
      if (isToken) {
        if (!ftPlan || !tokenInfo) throw new Error('FT-план не готов');
        receiverId = tokenInfo.ftContract;
        for (const item of ftPlan.items) {
          // We register storage for every receiver — Mintbase / NEAR
          // contracts return overpaid storage and ignore duplicate
          // registrations, so this is safe even when the receiver is
          // already registered.
          actions.push(buildFtStorageDepositAction(item.wallet));
          actions.push(buildFtTransferAction(item.wallet, item.rawAmount));
        }
      } else {
        if (!nftPlan) throw new Error('NFT-план не готов');
        if (!nftPlan.mintable) {
          // Out-of-collection title: skip on-chain entirely, just TG photo.
          setStage('done');
          return;
        }
        receiverId = NFT_CONTRACT;
        // Mints first — they store the metadata once per batch.
        for (const item of nftPlan.items) {
          if (item.mintCount > 0 && holdings?.template) {
            actions.push(buildNftMintAction(holdings.template, item.wallet, item.mintCount));
          }
        }
        const transferPairs: Array<[string, string]> = [];
        for (const item of nftPlan.items) {
          for (const tokenId of item.transferTokenIds) {
            transferPairs.push([tokenId, item.wallet]);
          }
        }
        if (transferPairs.length > 0) {
          actions.push(buildNftBatchTransferAction(transferPairs));
        }
      }

      if (actions.length === 0) {
        // Nothing to do — token list empty or NFT plan fully unmintable.
        setStage('done');
        return;
      }

      const txs = splitTxs(actions, receiverId);
      await walletObj.signAndSendTransactions({
        transactions: txs.map(t => ({ receiverId: t.receiverId, actions: t.actions })),
      });

      // 3. Place 👍 on photos for successfully on-chain wallets (only if we sent any)
      if (photoRecords.length > 0) {
        setStage('reacting');
        await placeReactions(photoRecords);
      }

      setStage('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage('error');
    }
  };

  const totalAggregated = aggregated.length;
  const transferTotal = nftPlan?.totalTransfer ?? 0;
  const mintTotal = nftPlan?.totalMint ?? 0;
  const shortfall = nftPlan?.unmintableShortfall ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-700 flex items-center justify-between">
          <h3 className="font-semibold text-gray-100">Выдача призов</h3>
          <button className="text-gray-400 hover:text-gray-100 text-xl leading-none" onClick={onClose}>✕</button>
        </div>

        <div className="px-5 py-3 text-sm text-gray-300 space-y-2 overflow-y-auto">
          <p>
            Приз: <span className="font-medium text-white">{prize.name}</span>{' '}
            <span className="text-gray-500">
              ({isToken ? `токен · ${prize.tokenAmount ?? 0} на победу` : 'NFT'})
            </span>
          </p>
          <p className="text-xs text-gray-400">
            Кошельков: <span className="text-white">{totalAggregated}</span>
            {!isToken && (
              <>
                {' · '}transfer: <span className="text-white">{transferTotal}</span>
                {' · '}mint: <span className="text-white">{mintTotal}</span>
                {shortfall > 0 && (
                  <span className="text-yellow-400 ml-1">⚠ не может быть выдано: {shortfall}</span>
                )}
              </>
            )}
          </p>
          {!isCollectionSigner && (
            <p className="text-yellow-400 text-xs">
              Подключён не {SIGNER_WALLET}. Выдача недоступна.
            </p>
          )}
          {!isToken && nftPlan && !mintable && (
            <p className="text-yellow-400 text-xs">
              Этот NFT не из коллекции {NFT_CONTRACT}. Сминтить нельзя — только фото в TG без 👍.
            </p>
          )}
          {error && <p className="text-red-400 text-xs break-words">{error}</p>}
          <div className="max-h-48 overflow-y-auto border border-gray-800 rounded-lg p-2 space-y-1 mt-2">
            {(isToken ? ftPlan?.items ?? [] : nftPlan?.items ?? []).map(item => (
              <div key={item.wallet} className="flex justify-between text-xs gap-2">
                <span className="text-gray-300 truncate">{item.wallet}</span>
                <span className="shrink-0 text-gray-400">
                  {isToken
                    ? `${prize.tokenAmount ? prize.tokenAmount * (aggregated.find(a => a.wallet === item.wallet)?.count ?? 0) : 0} ${prize.name}`
                    : (() => {
                        const i = item as { needed: number; transferTokenIds: string[]; mintCount: number };
                        return `${i.needed} (T${i.transferTokenIds.length}/M${i.mintCount})`;
                      })()}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-700 flex gap-2">
          <button
            onClick={doPayout}
            disabled={stage === 'planning' || stage === 'notifying' || stage === 'signing' || stage === 'reacting' || !isCollectionSigner || !walletObj}
            className="flex-1 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors"
          >
            {stage === 'planning' && 'Готовлю план...'}
            {stage === 'notifying' && 'Шлю админам в TG...'}
            {stage === 'signing' && 'Подпиши в кошельке...'}
            {stage === 'reacting' && 'Ставлю 👍...'}
            {stage === 'done' && '✓ Выдано'}
            {stage === 'error' && 'Попробовать снова'}
            {stage === 'idle' && 'Выдать призы'}
          </button>
          <button onClick={onClose} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors">
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
