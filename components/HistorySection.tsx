'use client';

import { useState } from 'react';
import { RaffleResult } from '@/lib/types';
import { generateCSV, downloadCSV, makeFilename, formatRaffleText } from '@/lib/csv';

interface Props {
  history: RaffleResult[];
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
      await doSend(result);
      alert('Отправлено!');
    } catch (e) {
      alert(`Ошибка: ${e instanceof Error ? e.message : 'Unknown'}`);
    } finally {
      setSending(prev => { const s = new Set(prev); s.delete(result.id); return s; });
    }
  };

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">История розыгрышей</h2>
      {[...history].reverse().map(result => (
        <div key={result.id} className="border border-gray-700 rounded-lg overflow-hidden">
          <div
            className="flex items-start justify-between p-3 gap-2 cursor-pointer hover:bg-gray-800 transition-colors"
            onClick={() => toggle(result.id)}
          >
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium">
                {new Date(result.timestamp).toLocaleString('ru-RU')}
              </span>
              <div className="text-xs text-gray-400 mt-0.5">
                {result.prizes.map(p => `${p.name} ×${p.count}`).join(', ')}
                {' · '}{result.winners.length} победит.
                {' · '}{result.availableAtDraw ?? result.totalTickets} бил.
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                className="px-2.5 py-1 bg-blue-700 hover:bg-blue-600 rounded text-xs disabled:opacity-40 transition-colors"
                onClick={e => { e.stopPropagation(); void sendToTelegram(result); }}
                disabled={sending.has(result.id)}
              >
                {sending.has(result.id) ? '...' : 'TG'}
              </button>
              <button
                className="px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
                onClick={e => { e.stopPropagation(); downloadCSV(generateCSV(result), makeFilename(result.prizes)); }}
              >
                CSV
              </button>
              <span className="text-gray-500 text-xs">{expanded.has(result.id) ? '▲' : '▼'}</span>
            </div>
          </div>

          {expanded.has(result.id) && (
            <div className="border-t border-gray-700 p-3">
              <div className="text-sm space-y-2 max-h-56 overflow-y-auto">
                <p className="font-medium text-gray-300 mb-2">Победители:</p>
                {result.winners.map(w => (
                  <div key={w.wallet} className="py-0.5">
                    <div className="flex justify-between gap-2">
                      <span className="truncate text-gray-200 font-medium">{w.wallet}</span>
                      <span className="shrink-0 text-white font-semibold">{w.prizeCount} шт</span>
                    </div>
                    <div className="text-gray-400 break-words leading-relaxed mt-0.5">
                      {w.winningNumbers.join(', ')}
                    </div>
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

async function sendOnce(result: RaffleResult): Promise<void> {
  const res = await fetch('/api/send-to-telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: formatRaffleText(result),
      csvString: generateCSV(result),
      filename: makeFilename(result.prizes),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = Array.isArray(err.errors) ? err.errors.join('\n') : (err.error ?? 'Unknown error');
    throw new Error(msg);
  }
}

export async function doSend(result: RaffleResult, attempts = 3): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await sendOnce(result); }
    catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}
