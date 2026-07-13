'use client';

// Prize-payout panel for the lottery operator (darai_collection.near).
//
// Flow when "Выдать призы" is clicked:
//   1. Plan
//        Token: read decimals + ft_contract from reward_tokens, build
//          storage_deposit + ft_transfer per winner.
//        NFT: ask Sendler what darai_collection.near holds under this title.
//          - own collection (yuplandshop) → transfer + mint remainder
//          - foreign collection AND enough on hand → pure transfer
//          - foreign collection AND short → externalShortage: CSV only, no on-chain
//   2. Admin notification (skipped when getNotifyTelegram() is false)
//        Build one CSV with winners + count, send it privately to every admin
//        in CSV_RECIPIENT_IDS as a sendDocument. Remember each (chatId,
//        messageId) so we can place 👍 later.
//   3. On-chain
//        Sign all actions via the connected wallet (hot-connector). Skip
//        completely on externalShortage.
//   4. Reaction
//        For every admin CSV that landed and whose payout succeeded on-chain,
//        ask /api/tg-react to drop 👍.

import { useEffect, useMemo, useState } from 'react';
import type { Prize, RaffleResult } from '@/lib/types';
import {
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

interface Holdings {
  contract: string;
  mintable: boolean;
  tokenIds: string[];
  template: NftTemplate | null;
}

interface Props {
  result: RaffleResult;
  walletAccount: string;
  walletObj: {
    signAndSendTransactions: (args: { transactions: Array<{ receiverId: string; actions: unknown[] }> }) => Promise<unknown>;
  } | null;
  /** CSV-сообщения, отправленные автоматически после розыгрыша. На них
   *  ставится 👍 после успешной on-chain выплаты — второй файл не шлётся. */
  csvDeliveries?: Array<{ chatId: string; messageId: number }>;
  onClose: () => void;
}

type Stage = 'idle' | 'planning' | 'notifying' | 'signing' | 'reacting' | 'done' | 'error';

interface DeliveryRecord { chatId: string; messageId: number; }

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function csvSafe(s: string): string {
  // Bare wallet ids / numbers don't need quoting, but if a token symbol ever
  // contained a comma we'd lose columns — be defensive.
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(prize: Prize, agg: WinnerAgg[]): string {
  if (prize.kind === 'token') {
    const perWinner = prize.tokenAmount ?? 0;
    const rows = ['wallet,amount,token', ...agg.map(a => `${csvSafe(a.wallet)},${perWinner * a.count},${csvSafe(prize.name)}`)];
    return rows.join('\n');
  }
  const rows = ['wallet,count,prize', ...agg.map(a => `${csvSafe(a.wallet)},${a.count},${csvSafe(prize.name)}`)];
  return rows.join('\n');
}

function csvFilename(prize: Prize): string {
  const safe = prize.name.trim().replace(/\s+/g, '_').replace(/[^\w\-А-Яа-яЁё]/g, '');
  return `${prize.kind === 'token' ? 'tokens_' : 'winners_'}${safe || 'prize'}_${Date.now()}.csv`;
}

export default function PayoutPanel({ result, walletAccount, walletObj, csvDeliveries, onClose }: Props) {
  // Only the first prize is supported — that matches the current raffle flow.
  const prize: Prize = result.prizes[0];
  const aggregated: WinnerAgg[] = useMemo(() => aggregateWinners(result.winners), [result.winners]);

  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [nftPlan, setNftPlan] = useState<NftPayoutPlan | null>(null);
  const [ftPlan, setFtPlan] = useState<FtPayoutPlan | null>(null);
  const [tokenInfo, setTokenInfo] = useState<RewardToken | null>(null);
  const [holdings, setHoldings] = useState<Holdings | null>(null);

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
          const r = await fetch('/lotoreya/api/reward-tokens');
          const data = await r.json();
          const tk: RewardToken | undefined = (data.items ?? []).find(
            (t: RewardToken) => t.symbol === prize.name,
          );
          if (!tk) throw new Error(`Токен ${prize.name} не найден в reward_tokens`);
          if (cancelled) return;
          setTokenInfo(tk);
          const p = planFtPayout({ prize, winners: aggregated, decimals: tk.decimals });
          p.ftContract = tk.ftContract;
          setFtPlan(p);
        } else {
          // No `contract` parameter — let Sendler tell us which collection
          // this title actually lives in (so we detect foreign collections).
          const r = await fetch(
            `/lotoreya/api/sendler-holdings?owner=${encodeURIComponent(walletAccount)}&title=${encodeURIComponent(prize.name)}`,
          );
          if (!r.ok) throw new Error(`Sendler ${r.status}`);
          const data = (await r.json()) as Holdings;
          if (cancelled) return;
          setHoldings(data);
          setNftPlan(planNftPayout({
            prize,
            winners: aggregated,
            signerHoldings: data.tokenIds,
            contract: data.contract,
            // Минтить может только владелец коллекции (darai_collection). Чужой
            // (HOT) кошелёк — только transfer из своих холдингов.
            mintable: data.mintable && isCollectionSigner,
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
  }, [aggregated, prize, isToken, walletAccount, isCollectionSigner]);

  const sendAdminCsv = async (): Promise<DeliveryRecord[]> => {
    const csv = buildCsv(prize, aggregated);
    const filename = csvFilename(prize);
    const caption = isToken
      ? `Раздача токенов: <b>${escapeHtml(prize.name)}</b> · победителей: ${aggregated.length}`
      : `Раздача NFT: <b>${escapeHtml(prize.name)}</b> · победителей: ${aggregated.length}`;
    try {
      const r = await fetch('/lotoreya/api/tg-admin-msg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: caption, csvString: csv, filename }),
      });
      const data = await r.json();
      return (data.deliveries ?? [])
        .filter((d: { messageId: number | null }) => typeof d.messageId === 'number')
        .map((d: { chatId: string; messageId: number }) => ({ chatId: d.chatId, messageId: d.messageId }));
    } catch {
      return [];
    }
  };

  const placeReactions = async (targets: DeliveryRecord[]) => {
    if (targets.length === 0) return;
    try {
      await fetch('/lotoreya/api/tg-react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets, emoji: '👍' }),
      });
    } catch { /* reactions are best-effort */ }
  };

  // После успешной выдачи коротко показываем «✓ Выдано» и закрываем окно.
  useEffect(() => {
    if (stage !== 'done') return;
    const t = setTimeout(() => onClose(), 1500);
    return () => clearTimeout(t);
  }, [stage, onClose]);

  const doPayout = async () => {
    if (!walletObj) { setError('Кошелёк не подключён'); setStage('error'); return; }
    setError(null);
    try {
      // 1. CSV уже автоматически отправлен сразу после розыгрыша
      //    (см. page.tsx::handleAnimationDone). Берём messageId'ы оттуда
      //    и реагируем на ТЕ ЖЕ сообщения — второй файл не шлём.
      const deliveries: DeliveryRecord[] = (csvDeliveries ?? []).map((d) => ({
        chatId: d.chatId,
        messageId: d.messageId,
      }));

      // 2. On-chain payout
      setStage('signing');
      let onChainSuccess = false;
      if (isToken) {
        if (!ftPlan || !tokenInfo) throw new Error('FT-план не готов');
        const actions: NearAction[] = [];
        for (const item of ftPlan.items) {
          actions.push(buildFtStorageDepositAction(item.wallet));
          actions.push(buildFtTransferAction(item.wallet, item.rawAmount));
        }
        const txs = splitTxs(actions, tokenInfo.ftContract);
        await walletObj.signAndSendTransactions({
          transactions: txs.map(t => ({ receiverId: t.receiverId, actions: t.actions })),
        });
        onChainSuccess = true;
      } else {
        if (!nftPlan) throw new Error('NFT-план не готов');
        // Foreign collection + not enough → just CSV in admins' chats, no on-chain.
        if (nftPlan.externalShortage) {
          setStage('done');
          return;
        }
        const actions: NearAction[] = [];
        // Mints first (only possible when mintable === true)
        if (nftPlan.mintable && holdings?.template) {
          for (const item of nftPlan.items) {
            if (item.mintCount > 0) {
              actions.push(buildNftMintAction(holdings.template, item.wallet, item.mintCount));
            }
          }
        }
        const transferPairs: Array<[string, string]> = [];
        for (const item of nftPlan.items) {
          for (const tokenId of item.transferTokenIds) {
            transferPairs.push([tokenId, item.wallet]);
          }
        }
        // Чанкуем пары: один nft_batch_transfer на ≤8 пар, чтобы рассылка многим
        // победителям не упёрлась в газовый потолок одного вызова. splitTxs ниже
        // разложит экшены по транзакциям (≤280 TGas каждая).
        const PAIRS_PER_BATCH = 8;
        for (let i = 0; i < transferPairs.length; i += PAIRS_PER_BATCH) {
          actions.push(buildNftBatchTransferAction(transferPairs.slice(i, i + PAIRS_PER_BATCH)));
        }
        if (actions.length === 0) {
          setStage('done');
          return;
        }
        const txs = splitTxs(actions, nftPlan.contract);
        await walletObj.signAndSendTransactions({
          transactions: txs.map(t => ({ receiverId: t.receiverId, actions: t.actions })),
        });
        onChainSuccess = true;
      }

      // 3. 👍 on the CSV messages we delivered, but only when on-chain went through
      if (onChainSuccess && deliveries.length > 0) {
        setStage('reacting');
        await placeReactions(deliveries);
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
  const externalShortage = nftPlan?.externalShortage ?? false;

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
              ({isToken ? `токен · ${prize.tokenAmount ?? 0} на победу` : `NFT · ${nftPlan?.contract || '...'}`})
            </span>
          </p>
          <p className="text-xs text-gray-400">
            Кошельков: <span className="text-white">{totalAggregated}</span>
            {!isToken && (
              <>
                {' · '}transfer: <span className="text-white">{transferTotal}</span>
                {nftPlan?.mintable && (<>{' · '}mint: <span className="text-white">{mintTotal}</span></>)}
              </>
            )}
          </p>
          {!isCollectionSigner && (
            <p className="text-cyan-400 text-xs">
              Раздача с подключённого кошелька ({walletAccount}) — отправим NFT, что есть на нём.
            </p>
          )}
          {!isToken && nftPlan && !nftPlan.mintable && !externalShortage && isCollectionSigner && (
            <p className="text-yellow-400 text-xs">
              Чужая коллекция ({nftPlan.contract || '?'}). Минт невозможен — отправим то, что есть на кошельке.
            </p>
          )}
          {externalShortage && (
            <p className="text-red-400 text-xs">
              На {walletAccount} только {nftPlan?.totalHoldings ?? 0} NFT, нужно {nftPlan?.totalNeeded ?? 0}.
              Минт невозможен. On-chain отправка пропускается — будет только CSV админам без 👍.
            </p>
          )}
          {error && <p className="text-red-400 text-xs break-words">{error}</p>}
          <div className="max-h-48 overflow-y-auto border border-gray-800 rounded-lg p-2 space-y-1 mt-2">
            {(isToken ? ftPlan?.items ?? [] : nftPlan?.items ?? []).map(item => (
              <div key={item.wallet} className="flex justify-between text-xs gap-2">
                <span className="text-gray-300 truncate">{item.wallet}</span>
                <span className="shrink-0 text-gray-400">
                  {isToken
                    ? `${(prize.tokenAmount ?? 0) * (aggregated.find(a => a.wallet === item.wallet)?.count ?? 0)} ${prize.name}`
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
            disabled={stage === 'planning' || stage === 'notifying' || stage === 'signing' || stage === 'reacting' || stage === 'done' || !walletObj}
            className="flex-1 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors"
          >
            {stage === 'planning' && 'Готовлю план...'}
            {stage === 'notifying' && 'Шлю CSV админам...'}
            {stage === 'signing' && 'Подпиши в кошельке...'}
            {stage === 'reacting' && 'Ставлю 👍...'}
            {stage === 'done' && '✓ Выдано'}
            {stage === 'error' && 'Попробовать снова'}
            {stage === 'idle' && (externalShortage ? 'Отправить CSV (без on-chain)' : 'Выдать призы')}
          </button>
          <button onClick={onClose} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors">
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
