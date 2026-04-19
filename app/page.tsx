'use client';

import { useState, useEffect, useRef } from 'react';
import NFTSection from '@/components/NFTSection';
import PrizeSection from '@/components/PrizeSection';
import HistorySection, { doSend } from '@/components/HistorySection';
import ResultModal from '@/components/ResultModal';
import { AppState, NFTQuery } from '@/lib/types';
import { loadState, saveState, resetState, exportState, importState } from '@/lib/storage';
import { runLottery, getTotalTickets } from '@/lib/lottery';
import { formatRaffleText } from '@/lib/csv';

interface PrizeForm {
  name: string;
  count: number;
}

export default function Home() {
  const [state, setState] = useState<AppState>({ queries: [], history: [], usedNumbers: [] });
  const [prize, setPrize] = useState<PrizeForm>({ name: '', count: 1 });
  const [sending, setSending] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [activePanel, setActivePanel] = useState<'nft' | 'prizes'>('nft');
  const [resultText, setResultText] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setState(loadState());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) saveState(state);
  }, [state, mounted]);

  const totalTickets = getTotalTickets(state.queries);
  const available = totalTickets - state.usedNumbers.length;

  // After NFT search: auto-collapse NFT panel, open prizes
  const handleSearchDone = (updatedQueries: NFTQuery[]) => {
    setState(prev => ({ ...prev, queries: updatedQueries }));
    setActivePanel('prizes');
  };

  const handleLottery = async () => {
    if (!state.queries.some(q => q.nfts.length > 0)) {
      alert('Сначала найдите NFT');
      return;
    }
    if (!prize.name.trim()) {
      alert('Введите название приза');
      return;
    }
    if (available <= 0) {
      alert('Все билеты разыграны. Нажмите «Сбросить всё».');
      return;
    }

    const prizeObj = { id: crypto.randomUUID(), name: prize.name.trim(), count: prize.count };
    const { result, capped, newUsedNumbers } = runLottery(state.queries, prizeObj, state.usedNumbers);

    if (capped) {
      const drawn = result.csvData.reduce((s, r) => s + r.count, 0);
      alert(`Призов больше доступных. Разыграно: ${drawn} из ${prize.count}.`);
    }

    setState(prev => ({
      ...prev,
      history: [...prev.history, result],
      usedNumbers: newUsedNumbers,
    }));

    // Show result modal
    setResultText(formatRaffleText(result));

    // Auto-send to Telegram
    setSending(true);
    try {
      await doSend(result);
    } catch (e) {
      alert(`Розыгрыш сохранён, ошибка TG:\n${e instanceof Error ? e.message : e}`);
    } finally {
      setSending(false);
    }
  };

  const handleReset = () => {
    if (!confirm('Сбросить все данные? Необратимо.')) return;
    setState(resetState());
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try { setState(await importState(file)); }
    catch { alert('Ошибка импорта'); }
    e.target.value = '';
  };

  if (!mounted) return null;

  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-4">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">NFT Lottery Raffle</h1>
          <span className="text-xs text-gray-500">Yupland · {new Date().getFullYear()}</span>
        </header>

        {/* Collapsible panels */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <NFTSection
            queries={state.queries}
            onChange={queries => setState(prev => ({ ...prev, queries }))}
            isOpen={activePanel === 'nft'}
            onToggle={() => setActivePanel(activePanel === 'nft' ? 'prizes' : 'nft')}
            onSearchDone={handleSearchDone}
          />
          <PrizeSection
            prize={prize}
            onChange={setPrize}
            totalTickets={totalTickets}
            usedNumbers={state.usedNumbers.length}
            onRaffle={handleLottery}
            sending={sending}
            isOpen={activePanel === 'prizes'}
            onToggle={() => setActivePanel(activePanel === 'prizes' ? 'nft' : 'prizes')}
          />
        </div>

        {/* Utility buttons */}
        <div className="flex justify-end gap-2">
          <button
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
            onClick={() => exportState(state)}
          >
            Экспорт
          </button>
          <button
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
            onClick={() => importRef.current?.click()}
          >
            Импорт
          </button>
          <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          <button
            className="px-4 py-2 bg-red-900 hover:bg-red-800 rounded-lg text-sm transition-colors"
            onClick={handleReset}
          >
            Сбросить всё
          </button>
        </div>

        <HistorySection history={state.history} />
      </div>

      {resultText && (
        <ResultModal text={resultText} onClose={() => setResultText(null)} />
      )}
    </main>
  );
}
