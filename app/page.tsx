'use client';

import { useState, useEffect, useRef } from 'react';
import NFTSection from '@/components/NFTSection';
import PrizeSection, { type PrizeForm } from '@/components/PrizeSection';
import HistorySection, { doSend } from '@/components/HistorySection';
import ResultModal from '@/components/ResultModal';
import LotteryAnimation from '@/components/LotteryAnimation';
import PayoutPanel from '@/components/PayoutPanel';
import { uid } from '@/lib/uid';
import { AppState, NFTQuery, RaffleResult, Winner, DrawState } from '@/lib/types';
import { loadState, saveState, resetState, exportState, importState } from '@/lib/storage';
import { runLottery, getTotalTickets } from '@/lib/lottery';
import { formatRaffleText } from '@/lib/csv';
import { getNotifyTelegram, setNotifyTelegram } from '@/lib/notifications';
import { getConnector } from '@/lib/near-connector';
import { pushLotteryResult, clearLotteryState, pushBgImage } from '@/app/actions/lottery-actions';

interface AnimData {
  prizeLabel: string;
  totalTickets: number;
  simultaneousCount: number;
  winners: Winner[];
  result: RaffleResult;
  newHistory: RaffleResult[];
  bgImage?: string;
}

// Reusable slide panel — collapses horizontally leaving a narrow strip with big arrow
function SlidePanel({
  children,
  isOpen,
  onOpen,
  arrowDir,
  label,
  bgImage,
  mobile = false,
}: {
  children: React.ReactNode;
  isOpen: boolean;
  onOpen: () => void;
  arrowDir: 'left' | 'right';
  label: string;
  bgImage?: string;
  mobile?: boolean;
}) {
  if (mobile) {
    return (
      <div className="relative rounded-xl bg-gray-800 overflow-hidden w-full">
        {bgImage && (
          <img src={bgImage} alt="" aria-hidden
            className="absolute inset-0 w-full h-full pointer-events-none select-none"
            style={{ objectFit: 'contain', objectPosition: 'center', opacity: 0.35 }}
          />
        )}
        <div className="relative z-10">{children}</div>
      </div>
    );
  }

  return (
    <div
      className="relative rounded-xl bg-gray-800 overflow-hidden flex-1"
      style={{
        maxWidth: isOpen ? '100%' : '4.5rem',
        minWidth: '4.5rem',
        transition: 'max-width 0.35s cubic-bezier(0.4,0,0.2,1)',
      }}
    >
      {bgImage && (
        <img
          src={bgImage}
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full pointer-events-none select-none"
          style={{ objectFit: 'contain', objectPosition: 'center', opacity: 0.35 }}
        />
      )}

      <div
        className="relative z-10"
        style={{
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
          transition: 'opacity 0.2s',
          minWidth: 280,
        }}
      >
        {children}
      </div>

      <div
        className="absolute inset-0 z-10 flex items-center justify-center"
        style={{
          opacity: isOpen ? 0 : 1,
          pointerEvents: isOpen ? 'none' : 'auto',
          transition: 'opacity 0.2s 0.1s',
        }}
      >
        <button
          className="w-16 h-16 rounded-full bg-blue-600 hover:bg-blue-500 shadow-2xl flex items-center justify-center transition-colors"
          onClick={onOpen}
          title={label}
        >
          <span className="text-white select-none" style={{ fontSize: '2.2rem', lineHeight: 1 }}>
            {arrowDir === 'right' ? '›' : '‹'}
          </span>
        </button>
      </div>
    </div>
  );
}

export default function Home() {
  const [state, setState] = useState<AppState>({ queries: [], history: [], usedNumbers: [] });
  const [prize, setPrize] = useState<PrizeForm>({ kind: 'nft', name: '', count: 1, simultaneousCount: 50 });
  const [sending, setSending] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [activePanel, setActivePanel] = useState<'nft' | 'prizes'>('nft');
  const [resultText, setResultText] = useState<string | null>(null);
  const [payoutResult, setPayoutResult] = useState<RaffleResult | null>(null);
  // deliveries — chatId+messageId CSV-сообщений из первой автоотправки;
  // PayoutPanel ставит 👍 на них вместо отправки второго файла.
  const [csvDeliveries, setCsvDeliveries] = useState<
    Array<{ chatId: string; messageId: number }>
  >([]);
  const [animData, setAnimData] = useState<AnimData | null>(null);
  const [notifyTg, setNotifyTg] = useState(true);
  const [wallet, setWallet] = useState<string | null>(null);
  const [walletObj, setWalletObj] = useState<{
    signAndSendTransactions: (args: { transactions: Array<{ receiverId: string; actions: unknown[] }> }) => Promise<unknown>;
  } | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setNotifyTg(getNotifyTelegram()); }, []);
  const toggleNotify = () => {
    setNotifyTg(v => { const next = !v; setNotifyTelegram(next); return next; });
  };

  // NEAR wallet — ТОЛЬКО внешний кош (near-connect/HOT). Подпись через
  // встроенный YupLink-кошелёк (/wallet/sign) убрана: подписываем ровно тем
  // кошельком, что подключён снаружи (HOT и т.п.).
  useEffect(() => {
    let cancelled = false;
    // Чистим возможный старый флаг YupLink, чтобы он не перехватывал подпись.
    try { localStorage.removeItem('lotoreya-yuplink'); } catch { /* ignore */ }
    (async () => {
      const c = await getConnector();
      if (!c || cancelled) return;
      const refresh = async () => {
        try {
          const existing = await c.getConnectedWallet();
          const id = existing?.accounts?.[0]?.accountId;
          if (cancelled) return;
          if (id) {
            setWallet(id);
            setWalletObj((existing.wallet as unknown) as typeof walletObj extends infer T ? T : never);
          } else {
            setWallet(null);
            setWalletObj(null);
          }
        } catch { /* ignore */ }
      };
      const onSignIn = ({ accounts }: { accounts: Array<{ accountId: string }> }) => {
        const id = accounts[0]?.accountId;
        if (id) setWallet(id);
        refresh();
      };
      const onSignOut = () => { setWallet(null); setWalletObj(null); };
      c.on('wallet:signIn', onSignIn);
      c.on('wallet:signOut', onSignOut);
      await refresh();
      return () => {
        c.off('wallet:signIn', onSignIn);
        c.off('wallet:signOut', onSignOut);
      };
    })();
    return () => { cancelled = true; };
  }, []);

  const connectWallet = async () => {
    setWalletBusy(true);
    try {
      try { localStorage.removeItem('lotoreya-yuplink'); } catch { /* ignore */ }
      const c = await getConnector();
      if (c) await c.connect();
    } catch { /* user cancelled / popup blocked */ }
    finally { setWalletBusy(false); }
  };

  const disconnectWallet = async () => {
    try { localStorage.removeItem('lotoreya-yuplink'); } catch { /* ignore */ }
    try {
      const c = await getConnector();
      if (c) await c.disconnect();
    } catch { /* ignore */ }
    setWallet(null);
    setWalletObj(null);
  };

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    const loaded = loadState();
    setState(loaded);
    setMounted(true);
    // Синхронизируем localStorage → серверный стейт (для /watch)
    if (loaded.history.length > 0) {
      const latest = loaded.history[loaded.history.length - 1];
      const latestDraw: DrawState = {
        id: latest.id,
        prizeLabel: latest.prizes.map(p => `${p.name} × ${p.count}`).join(' + '),
        totalTickets: latest.totalTickets,
        winners: latest.winners,
        timestamp: latest.timestamp,
      };
      pushLotteryResult({ latestDraw, history: loaded.history }).catch(console.error);
    }
  }, []);
  useEffect(() => { if (mounted) saveState(state); }, [state, mounted]);

  const totalTickets = getTotalTickets(state.queries);
  const available = totalTickets - state.usedNumbers.length;

  // Find the NFT with the highest ticket count to use as prize panel background
  const bgImage = (() => {
    let best: { tickets: number; media: string } | null = null;
    for (const q of state.queries) {
      for (const nft of q.nfts) {
        if (nft.media && (!best || nft.tickets > best.tickets)) {
          best = { tickets: nft.tickets, media: nft.media };
        }
      }
    }
    return best?.media;
  })();

  const handleSearchDone = (updatedQueries: NFTQuery[]) => {
    setState(prev => ({ ...prev, queries: updatedQueries }));
    setActivePanel('prizes');

    let best: { tickets: number; media: string } | null = null;
    for (const q of updatedQueries) {
      for (const nft of q.nfts) {
        if (nft.media && (!best || nft.tickets > best.tickets)) {
          best = { tickets: nft.tickets, media: nft.media };
        }
      }
    }
    pushBgImage(best?.media ?? null).catch(console.error);
  };

  const handleLottery = async () => {
    if (!state.queries.some(q => q.nfts.length > 0)) { alert('Сначала найдите NFT'); return; }
    if (!prize.name.trim()) { alert('Введите название приза'); return; }
    if (available <= 0) { alert('Все билеты разыграны. Нажмите «Сбросить всё».'); return; }

    const prizeObj = {
      id: uid(),
      name: prize.name.trim(),
      count: prize.count,
      kind: prize.kind,
      tokenAmount: prize.kind === 'token' ? prize.tokenAmount : undefined,
    };
    const { result, capped, newUsedNumbers } = runLottery(state.queries, prizeObj, state.usedNumbers);

    if (capped) {
      alert(`Призов больше доступных. Разыграно: ${result.csvData.reduce((s, r) => s + r.count, 0)} из ${prize.count}.`);
    }

    const newHistory = [...state.history, result];
    setState(prev => ({ ...prev, history: newHistory, usedNumbers: newUsedNumbers }));

    const prizeLabel = result.prizes.map(p => `${p.name} × ${p.count}`).join(' + ');
    setAnimData({ prizeLabel, totalTickets, simultaneousCount: prize.simultaneousCount, winners: result.winners, result, newHistory, bgImage });
  };

  const handleAnimationDone = async () => {
    if (!animData) return;
    const { result, prizeLabel, newHistory } = animData;
    setAnimData(null);

    // Show result text in modal + remember the result so the operator can
    // open the payout panel right after the modal.
    setResultText(formatRaffleText(result));
    setPayoutResult(result);
    setCsvDeliveries([]);

    // Send to Telegram (skip if the user disabled auto-notifications)
    if (notifyTg) {
      setSending(true);
      try {
        const deliveries = await doSend(result);
        // Сохраняем messageId автоотправленного CSV — PayoutPanel ставит на
        // него 👍 после on-chain выплаты вместо отправки второго файла.
        setCsvDeliveries(deliveries);
      }
      catch (e) { alert(`Розыгрыш сохранён, ошибка TG:\n${e instanceof Error ? e.message : e}`); }
      finally { setSending(false); }
    }

    // Push to spectator page (fire and forget)
    const draw: DrawState = {
      id: result.id,
      prizeLabel,
      totalTickets: animData.totalTickets,
      simultaneousCount: animData.simultaneousCount,
      winners: result.winners,
      timestamp: result.timestamp,
      bgImage: animData.bgImage,
    };
    pushLotteryResult({ latestDraw: draw, history: newHistory }).catch(console.error);
  };

  const handleReset = () => {
    if (!confirm('Сбросить все данные? Необратимо.')) return;
    setState(resetState());
    clearLotteryState().catch(console.error);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try { setState(await importState(file)); } catch { alert('Ошибка импорта'); }
    e.target.value = '';
  };

  if (!mounted) return null;

  return (
    <main className="min-h-screen p-3 md:p-8">
      <div className="max-w-5xl mx-auto space-y-3 md:space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 md:gap-3">
            {/* Назад в YupLink. Лотерея проксируется на service.yupland.io/lotoreya,
                YupLink (golden-drop) — на корне service.yupland.io. raw <a href="/">
                НЕ префиксится Next basePath'ом → ведёт на YupLink, а не на лотерею. */}
            <a
              href="/"
              title="Назад в YupLink"
              className="px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs transition-colors flex items-center gap-1 shrink-0"
            >
              <span aria-hidden>←</span> YupLink
            </a>
            <h1 className="text-lg md:text-2xl font-bold tracking-tight">NFT Lottery Raffle</h1>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/watch"
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs transition-colors flex items-center gap-1.5"
            >
              <span
                className="inline-block w-1.5 h-1.5 rounded-full bg-green-400"
                style={{ boxShadow: '0 0 5px rgba(74,222,128,0.8)' }}
              />
              Эфир
            </a>
            {wallet ? (
              <button
                onClick={disconnectWallet}
                title="Отключить кошелёк"
                className="px-3 py-1.5 bg-gray-700 hover:bg-red-800 rounded-lg text-xs transition-colors flex items-center gap-1.5 max-w-[10rem]"
              >
                <span className="truncate">{wallet}</span>
                <span className="text-gray-400">✕</span>
              </button>
            ) : (
              <button
                onClick={connectWallet}
                disabled={walletBusy}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg text-xs transition-colors"
              >
                {walletBusy ? 'Подключение…' : 'Подключить кошелёк'}
              </button>
            )}
            <span className="text-xs text-gray-500 hidden sm:inline">Yupland · {new Date().getFullYear()}</span>
          </div>
        </header>

        {/* Panels: stacked on mobile, side-by-side on desktop */}
        <div className={isMobile ? 'flex flex-col gap-3' : 'flex gap-4'} style={isMobile ? {} : { minHeight: '320px' }}>
          <SlidePanel
            isOpen={activePanel === 'nft'}
            onOpen={() => setActivePanel('nft')}
            arrowDir="right"
            label="Открыть NFT / Билеты"
            mobile={isMobile}
          >
            <NFTSection
              queries={state.queries}
              onChange={queries => setState(prev => ({ ...prev, queries }))}
              onSearchDone={handleSearchDone}
              notifyTelegram={notifyTg}
            />
          </SlidePanel>

          <SlidePanel
            isOpen={activePanel === 'prizes'}
            onOpen={() => setActivePanel('prizes')}
            arrowDir="left"
            label="Открыть Призы"
            bgImage={bgImage}
            mobile={isMobile}
          >
            <PrizeSection
              prize={prize}
              onChange={setPrize}
              totalTickets={totalTickets}
              usedNumbers={state.usedNumbers.length}
              onRaffle={handleLottery}
              sending={sending}
              walletAccount={wallet}
            />
          </SlidePanel>
        </div>

        {/* Utility buttons */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="flex items-center gap-2 mr-auto select-none cursor-pointer text-sm text-gray-300">
            <input
              type="checkbox"
              checked={!notifyTg}
              onChange={toggleNotify}
              className="w-4 h-4 accent-blue-500"
            />
            Не отправлять в Telegram
          </label>
          <button className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors" onClick={() => exportState(state)}>Экспорт</button>
          <button className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors" onClick={() => importRef.current?.click()}>Импорт</button>
          <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          <button className="px-3 py-2 bg-red-900 hover:bg-red-800 rounded-lg text-sm transition-colors" onClick={handleReset}>Сбросить всё</button>
        </div>

        <HistorySection history={state.history} />
      </div>

      {resultText && (
        <ResultModal
          text={resultText}
          onClose={() => setResultText(null)}
          onPayout={
            !!wallet && payoutResult
              ? () => { setResultText(null); /* keep payoutResult to open PayoutPanel */ }
              : undefined
          }
        />
      )}

      {payoutResult && !resultText && !!wallet && (
        <PayoutPanel
          result={payoutResult}
          walletAccount={wallet}
          walletObj={walletObj}
          csvDeliveries={csvDeliveries}
          onClose={() => setPayoutResult(null)}
        />
      )}

      {animData && (
        <LotteryAnimation
          prizeLabel={animData.prizeLabel}
          totalTickets={animData.totalTickets}
          simultaneousCount={animData.simultaneousCount}
          winners={animData.winners}
          onDone={handleAnimationDone}
        />
      )}
    </main>
  );
}
