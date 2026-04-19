'use client';

import { useState } from 'react';
import { NFTQuery, NFTItem } from '@/lib/types';
import { extractTicketCount } from '@/lib/nft-parser';
import { getWalletRanges, getTotalTickets } from '@/lib/lottery';

interface Props {
  queries: NFTQuery[];
  onChange: (queries: NFTQuery[]) => void;
}

async function sendOverviewToTelegram(queries: NFTQuery[]): Promise<void> {
  const ranges = getWalletRanges(queries);
  const total = ranges.length ? ranges[ranges.length - 1].end : 0;
  const lines = [`Всего билетов: ${total}`, ''];
  for (const { wallet, tickets, start, end } of ranges) {
    lines.push(`${wallet} — ${tickets} билетов (${start}-${end})`);
  }
  const res = await fetch('/api/send-to-telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: lines.join('\n') }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(Array.isArray(err.errors) ? err.errors.join('\n') : (err.error ?? 'Unknown'));
  }
}

export default function NFTSection({ queries, onChange }: Props) {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [showResults, setShowResults] = useState(false);
  const [sendingOverview, setSendingOverview] = useState(false);

  const addQuery = () =>
    onChange([...queries, { id: crypto.randomUUID(), searchTitle: '', nfts: [] }]);

  const removeQuery = (id: string) => onChange(queries.filter(q => q.id !== id));

  const updateTitle = (id: string, title: string) =>
    onChange(queries.map(q => (q.id === id ? { ...q, searchTitle: title } : q)));

  const searchOne = async (query: NFTQuery): Promise<NFTItem[]> => {
    if (!query.searchTitle.trim()) return query.nfts;
    try {
      const res = await fetch(`/api/search-nft?title=${encodeURIComponent(query.searchTitle)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return (data.items ?? []).map((item: Record<string, string>) => ({
        token_id: item.token_id,
        title: item.title,
        owner_id: item.owner_id,
        tickets: extractTicketCount(item.title),
      }));
    } catch (e) {
      setErrors(prev => new Map(prev).set(query.id, 'Ошибка загрузки'));
      return query.nfts;
    }
  };

  const searchAll = async () => {
    const active = queries.filter(q => q.searchTitle.trim());
    if (!active.length) return;
    setLoading(true);
    setErrors(new Map());
    const results = await Promise.all(queries.map(searchOne));
    onChange(queries.map((q, i) => ({ ...q, nfts: results[i] })));
    setShowResults(true);
    setLoading(false);
  };

  const handleOverview = async () => {
    setSendingOverview(true);
    try {
      await sendOverviewToTelegram(queries);
      alert('Обзор отправлен в чат!');
    } catch (e) {
      alert(`Ошибка: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSendingOverview(false);
    }
  };

  const ranges = getWalletRanges(queries);
  const totalTickets = ranges.length ? ranges[ranges.length - 1].end : 0;
  const hasResults = queries.some(q => q.nfts.length > 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">NFT / Билеты</h2>
        {totalTickets > 0 && (
          <span className="text-sm text-gray-400">
            {ranges.length} кошельков · {totalTickets} билетов
          </span>
        )}
      </div>

      {/* Search fields */}
      {queries.map(query => (
        <div key={query.id} className="flex gap-2">
          <input
            className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            placeholder="Название NFT для поиска"
            value={query.searchTitle}
            onChange={e => updateTitle(query.id, e.target.value)}
            onKeyDown={e => e.key === 'Enter' && searchAll()}
          />
          <button
            className="px-3 py-2 bg-gray-600 hover:bg-red-800 rounded-lg text-sm transition-colors"
            onClick={() => removeQuery(query.id)}
          >
            ✕
          </button>
          {errors.get(query.id) && (
            <span className="text-red-400 text-xs self-center">{errors.get(query.id)}</span>
          )}
        </div>
      ))}

      <button
        className="w-full py-1.5 border border-dashed border-gray-600 hover:border-gray-400 rounded-lg text-xs text-gray-500 hover:text-gray-300 transition-colors"
        onClick={addQuery}
      >
        + добавить поле поиска
      </button>

      {/* Single search button */}
      <button
        className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors"
        onClick={searchAll}
        disabled={loading || !queries.some(q => q.searchTitle.trim())}
      >
        {loading ? 'Поиск...' : 'Найти NFT'}
      </button>

      {/* Collapsible results */}
      {hasResults && (
        <div className="border border-gray-700 rounded-lg overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-700 transition-colors"
            onClick={() => setShowResults(v => !v)}
          >
            <span className="text-gray-300 font-medium">
              Результаты: {queries.reduce((s, q) => s + q.nfts.length, 0)} NFT
            </span>
            <span className="text-gray-500">{showResults ? '▲' : '▼'}</span>
          </button>

          {showResults && (
            <div className="border-t border-gray-700 p-3 space-y-3">
              {/* Per-query NFT list */}
              {queries.filter(q => q.nfts.length > 0).map(query => (
                <div key={query.id} className="text-xs">
                  <p className="text-gray-400 mb-1 font-medium">«{query.searchTitle}» — {query.nfts.length} NFT</p>
                  <div className="max-h-32 overflow-y-auto space-y-0.5">
                    {query.nfts.map(nft => (
                      <div key={nft.token_id} className="flex justify-between gap-2 text-gray-500">
                        <span className="truncate" title={nft.title}>{nft.title}</span>
                        <span className="shrink-0 text-blue-400">{nft.tickets}т · {nft.owner_id.slice(0, 18)}…</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Wallet summary sorted by tickets desc */}
              <div className="border-t border-gray-700 pt-2 text-xs space-y-1">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-medium text-gray-300">Кошельки (по убыванию билетов):</p>
                  <button
                    className="px-2.5 py-1 bg-indigo-700 hover:bg-indigo-600 rounded text-xs disabled:opacity-40 transition-colors"
                    onClick={handleOverview}
                    disabled={sendingOverview}
                  >
                    {sendingOverview ? '...' : 'Обзор в TG'}
                  </button>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-0.5">
                  {ranges.map(({ wallet, tickets, start, end }) => (
                    <div key={wallet} className="flex justify-between gap-2 text-gray-400">
                      <span className="truncate">{wallet}</span>
                      <span className="shrink-0 text-gray-300">
                        {tickets} <span className="text-gray-600">({start}–{end})</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
