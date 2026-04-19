'use client';

import { useState, useEffect, useRef } from 'react';
import NFTSection from '@/components/NFTSection';
import PrizeSection from '@/components/PrizeSection';
import HistorySection, { doSend } from '@/components/HistorySection';
import { AppState } from '@/lib/types';
import { loadState, saveState, resetState, exportState, importState } from '@/lib/storage';
import { runLottery, getTotalTickets } from '@/lib/lottery';

interface PrizeForm {
  name: string;
  count: number;
}

export default function Home() {
  const [state, setState] = useState<AppState>({ queries: [], history: [], usedNumbers: [] });
  const [prize, setPrize] = useState<PrizeForm>({ name: '', count: 1 });
  const [sending, setSending] = useState(false);
  const [mounted, setMounted] = useState(false);
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

  const handleLottery = async () => {
    if (!state.queries.some(q => q.nfts.length > 0)) {
      alert('Сначала найдите NFT через поиск');
      return;
    }
    if (!prize.name.trim()) {
      alert('Введите название приза');
      return;
    }
    if (available <= 0) {
      alert('Все билеты уже разыграны. Нажмите «Сбросить всё» для новой сессии.');
      return;
    }

    const prizeObj = { id: crypto.randomUUID(), name: prize.name.trim(), count: prize.count };
    const { result, capped, newUsedNumbers } = runLottery(state.queries, prizeObj, state.usedNumbers);

    if (capped) {
      const drawn = result.csvData.reduce((s, r) => s + r.count, 0);
      alert(`Призов больше доступных билетов. Разыграно: ${drawn} из ${prize.count}.`);
    }

    const nextState = {
      ...state,
      history: [...state.history, result],
      usedNumbers: newUsedNumbers,
    };
    setState(nextState);

    // Auto-send to Telegram
    setSending(true);
    try {
      await doSend(result);
    } catch (e) {
      alert(`Розыгрыш сохранён, но ошибка отправки в TG:\n${e instanceof Error ? e.message : e}`);
    } finally {
      setSending(false);
    }
  };

  const handleReset = () => {
    if (!confirm('Сбросить все данные? Это действие необратимо.')) return;
    setState(resetState());
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setState(await importState(file));
    } catch {
      alert('Ошибка импорта — неверный формат файла');
    }
    e.target.value = '';
  };

  if (!mounted) return null;

  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">NFT Lottery Raffle</h1>
          <span className="text-xs text-gray-500">Yupland · {new Date().getFullYear()}</span>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-gray-800 rounded-xl p-5">
            <NFTSection
              queries={state.queries}
              onChange={queries => setState(prev => ({ ...prev, queries }))}
            />
          </div>
          <div className="bg-gray-800 rounded-xl p-5">
            <PrizeSection
              prize={prize}
              onChange={setPrize}
              totalTickets={totalTickets}
              usedNumbers={state.usedNumbers.length}
              onRaffle={handleLottery}
              sending={sending}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <div className="flex gap-2">
            <button
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
              onClick={() => exportState(state)}
            >
              Экспорт JSON
            </button>
            <button
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
              onClick={() => importRef.current?.click()}
            >
              Импорт JSON
            </button>
            <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
            <button
              className="px-4 py-2 bg-red-900 hover:bg-red-800 rounded-lg text-sm transition-colors"
              onClick={handleReset}
            >
              Сбросить всё
            </button>
          </div>
        </div>

        <HistorySection history={state.history} />
      </div>
    </main>
  );
}
