'use client';

import { useEffect, useRef, useState } from 'react';
import { DrawState, RaffleResult, ServerState } from '@/lib/types';
import { generateCSV, downloadCSV, makeFilename } from '@/lib/csv';
import LotteryAnimation from '@/components/LotteryAnimation';

export default function WatchPage() {
  const [history, setHistory] = useState<RaffleResult[]>([]);
  const [latestDraw, setLatestDraw] = useState<DrawState | null>(null);
  const [animating, setAnimating] = useState<DrawState | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);
  const [kvMissing, setKvMissing] = useState(false);

  // undefined = not yet initialized (skip animation on first load)
  const lastDrawId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/lottery-state');
        if (!res.ok) return;
        const data: ServerState & { _kvConfigured?: boolean } = await res.json();

        setConnected(true);
        setKvMissing(data._kvConfigured === false);
        setHistory(data.history ?? []);
        setLatestDraw(data.latestDraw);

        if (lastDrawId.current === undefined) {
          // First load — mark current draw as seen, don't replay old animation
          lastDrawId.current = data.latestDraw?.id ?? null;
        } else if (data.latestDraw && data.latestDraw.id !== lastDrawId.current) {
          // New draw detected while watching — trigger animation
          lastDrawId.current = data.latestDraw.id;
          setAnimating(data.latestDraw);
        }
      } catch { /* ignore network errors */ }
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, []);

  const toggle = (id: string) =>
    setExpanded(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });

  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-5">

        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">NFT Lottery — Эфир</h1>
            <div className="flex items-center gap-1.5 mt-1">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{
                  background: connected ? '#4ade80' : '#6b7280',
                  boxShadow: connected ? '0 0 6px rgba(74,222,128,0.7)' : 'none',
                  animation: connected ? 'pulse 2s infinite' : 'none',
                }}
              />
              <span className="text-xs text-gray-400">
                {connected ? 'Прямой эфир' : 'Подключение...'}
              </span>
            </div>
          </div>
          <span className="text-xs text-gray-500">Yupland · {new Date().getFullYear()}</span>
        </header>

        {/* KV not configured warning */}
        {kvMissing && (
          <div className="rounded-xl bg-red-900/60 border border-red-500 p-3 text-xs">
            <p className="font-semibold text-red-200 mb-1">⚠ Vercel KV не подключён</p>
            <p className="text-red-100/90">
              На Vercel без KV состояние теряется между инстансами.
              Откройте проект на vercel.com → <b>Storage</b> → <b>Create Database</b> → <b>Upstash KV (Redis)</b> → <b>Connect Project</b>.
              После подключения сделайте редеплой.
            </p>
          </div>
        )}

        {/* Status card */}
        <div className="rounded-xl bg-gray-800 p-4 text-sm">
          {latestDraw ? (
            <>
              <p className="text-xs text-gray-500 mb-0.5">Последний розыгрыш</p>
              <p className="font-semibold text-white">{latestDraw.prizeLabel}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {new Date(latestDraw.timestamp).toLocaleString('ru-RU')}
                {' · '}
                {latestDraw.winners.reduce((s, w) => s + w.prizeCount, 0)} призов
                {' · '}
                {latestDraw.winners.length} победит.
              </p>
            </>
          ) : (
            <p className="text-gray-500">Ожидание розыгрыша...</p>
          )}
        </div>

        {/* History */}
        {history.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-gray-200">История розыгрышей</h2>
            {[...history].reverse().map(result => (
              <div key={result.id} className="border border-gray-700 rounded-lg overflow-hidden">
                <div
                  className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-800 transition-colors"
                  onClick={() => toggle(result.id)}
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium">
                      {new Date(result.timestamp).toLocaleString('ru-RU')}
                    </span>
                    <span className="ml-2 text-xs text-gray-400">
                      {result.prizes.map(p => `${p.name} ×${p.count}`).join(', ')}
                      {' · '}
                      {result.winners.length} победит.
                    </span>
                  </div>
                  <div className="flex items-center gap-2 ml-3 shrink-0">
                    <button
                      className="px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
                      onClick={e => {
                        e.stopPropagation();
                        downloadCSV(generateCSV(result), makeFilename(result.prizes));
                      }}
                    >
                      CSV ↓
                    </button>
                    <span className="text-gray-500 text-xs">
                      {expanded.has(result.id) ? '▲' : '▼'}
                    </span>
                  </div>
                </div>

                {expanded.has(result.id) && (
                  <div className="border-t border-gray-700 p-3">
                    <div className="text-xs space-y-1 max-h-56 overflow-y-auto">
                      <p className="font-medium text-gray-300 mb-2">Победители:</p>
                      {result.winners.map(w => (
                        <div key={w.wallet} className="flex justify-between gap-2 py-0.5 text-gray-400">
                          <span className="truncate">{w.wallet}</span>
                          <span className="shrink-0 text-gray-200">
                            {w.prizeCount} шт{' '}
                            <span className="text-gray-500">[{w.winningNumbers.join(', ')}]</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {connected && history.length === 0 && !latestDraw && (
          <p className="text-center text-gray-500 text-sm py-12">Розыгрышей пока не было</p>
        )}
      </div>

      {/* Animation overlay — only shown when a new draw is detected */}
      {animating && (
        <LotteryAnimation
          prizeLabel={animating.prizeLabel}
          totalTickets={animating.totalTickets}
          simultaneousCount={animating.simultaneousCount ?? 5}
          winners={animating.winners}
          onDone={() => setAnimating(null)}
        />
      )}
    </main>
  );
}
