'use client';

import { useState, useEffect, useRef } from 'react';
import NFTSection from '@/components/NFTSection';
import PrizeSection from '@/components/PrizeSection';
import HistorySection from '@/components/HistorySection';
import { AppState } from '@/lib/types';
import { loadState, saveState, resetState, exportState, importState } from '@/lib/storage';
import { runLottery, getTotalTickets } from '@/lib/lottery';

export default function Home() {
  const [state, setState] = useState<AppState>({ queries: [], prizes: [], history: [] });
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

  const handleLottery = () => {
    const hasNFTs = state.queries.some(q => q.nfts.length > 0);
    if (!hasNFTs) {
      alert('Сначала найдите NFT через поиск');
      return;
    }
    const hasPrizes = state.prizes.some(p => p.count > 0);
    if (!hasPrizes) {
      alert('Добавьте хотя бы один приз');
      return;
    }

    const { result, capped } = runLottery(state.queries, state.prizes);

    if (capped) {
      const drawn = result.csvData.reduce((s, r) => s + r.count, 0);
      alert(
        `Призов больше, чем билетов. Разыграно: ${drawn} из ${state.prizes.reduce((s, p) => s + p.count, 0)}.`,
      );
    }

    setState(prev => ({ ...prev, history: [...prev.history, result] }));
  };

  const handleReset = () => {
    if (!confirm('Сбросить все данные? Это действие необратимо.')) return;
    setState(resetState());
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const imported = await importState(file);
      setState(imported);
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
              prizes={state.prizes}
              onChange={prizes => setState(prev => ({ ...prev, prizes }))}
              totalTickets={totalTickets}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <button
            className="px-6 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-40 rounded-lg font-medium transition-colors"
            onClick={handleLottery}
            disabled={totalTickets === 0}
          >
            Провести розыгрыш
          </button>

          <div className="flex gap-2 ml-auto">
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
            <input
              ref={importRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleImport}
            />
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
