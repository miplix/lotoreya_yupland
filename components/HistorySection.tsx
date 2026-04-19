'use client';

import { useState } from 'react';
import { RaffleResult, Prize } from '@/lib/types';
import { generateCSV, downloadCSV } from '@/lib/csv';

interface Props {
  history: RaffleResult[];
}

// "газировка 1 лвл" × 50 → "газировка_1_лвл_50.csv"
function makeFilename(prizes: Prize[]): string {
  const parts = prizes.map(p => `${p.name.trim().replace(/\s+/g, '_')}_${p.count}`);
  return `${parts.join('_')}.csv`;
}

// Text for the group chat
function formatText(result: RaffleResult): string {
  const header = result.prizes.map(p => `${p.name} × ${p.count}`).join(' + ');
  const lines = [header, ''];
  for (const w of result.winners) {
    lines.push(`${w.wallet} — ${w.prizeCount} шт     ${w.winningNumbers.join(', ')}`);
  }
  return lines.join('\n');
}

export default function HistorySection({ history }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState<Set<string>>(new Set());

  if (history.length === 0) return null;

  const toggle = (id: string) =>
    setExpanded(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });

  const sendToTelegram = async (result: RaffleResult) => {
    setSending(prev => new Set(prev).add(result.id));
    try {
      const res = await fetch('/api/send-to-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: formatText(result),
          csvString: generateCSV(result),
          filename: makeFilename(result.prizes),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        const msg = err.errors ? err.errors.join('\n') : err.error ?? 'Unknown error';
        throw new Error(msg);
      }
      alert('Отправлено!');
    } catch (e) {
      alert(`Ошибка: ${e instanceof Error ? e.message : 'Unknown'}`);
    } finally {
      setSending(prev => { const s = new Set(prev); s.delete(result.id); return s; });
    }
  };

  const handleDownload = (result: RaffleResult) => {
    downloadCSV(generateCSV(result), makeFilename(result.prizes));
  };

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">История розыгрышей</h2>
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
              <span className="ml-3 text-xs text-gray-400">
                {result.winners.length} победит. · {result.totalTickets} билетов ·{' '}
                {result.prizes.map(p => `${p.name} ×${p.count}`).join(', ')}
              </span>
            </div>
            <div className="flex items-center gap-2 ml-3 shrink-0">
              <button
                className="px-2.5 py-1 bg-blue-700 hover:bg-blue-600 rounded text-xs disabled:opacity-40 transition-colors"
                onClick={e => { e.stopPropagation(); void sendToTelegram(result); }}
                disabled={sending.has(result.id)}
              >
                {sending.has(result.id) ? '...' : 'TG'}
              </button>
              <button
                className="px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
                onClick={e => { e.stopPropagation(); handleDownload(result); }}
              >
                CSV
              </button>
              <span className="text-gray-500 text-xs">{expanded.has(result.id) ? '▲' : '▼'}</span>
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
  );
}
