'use client';

import { useState } from 'react';
import { NFTQuery, NFTItem } from '@/lib/types';
import { extractTicketCount } from '@/lib/nft-parser';
import { getWalletRanges } from '@/lib/lottery';

interface Props {
  queries: NFTQuery[];
  onChange: (queries: NFTQuery[]) => void;
  isOpen: boolean;
  onToggle: () => void;
  onSearchDone: (updatedQueries: NFTQuery[]) => void;
}

async function sendOverview(queries: NFTQuery[]): Promise<void> {
  const ranges = getWalletRanges(queries);
  const total = ranges.length ? ranges[ranges.length - 1].end : 0;
  const lines = [`Всего билетов: ${total}`, ''];
  for (const { wallet, tickets, start, end } of ranges) {
    lines.push(`${wallet} — ${tickets} билетов (${start}–${end})`);
  }
  await fetch('/api/send-to-telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: lines.join('\n') }),
  });
}

export default function NFTSection({ queries, onChange, isOpen, onToggle, onSearchDone }: Props) {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Map<string, string>>(new Map());

  const addQuery = () =>
    onChange([...queries, { id: crypto.randomUUID(), searchTitle: '', nfts: [] }]);

  const removeQuery = (id: string) => onChange(queries.filter(q => q.id !== id));

  const updateTitle = (id: string, title: string) =>
    onChange(queries.map(q => (q.id === id ? { ...q, searchTitle: title } : q)));

  const searchAll = async () => {
    const hasTerms = queries.some(q => q.searchTitle.trim());
    if (!hasTerms) return;
    setLoading(true);
    setErrors(new Map());

    const results = await Promise.all(
      queries.map(async (q): Promise<NFTItem[]> => {
        if (!q.searchTitle.trim()) return q.nfts;
        try {
          const res = await fetch(`/api/search-nft?title=${encodeURIComponent(q.searchTitle)}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          return (data.items ?? []).map((item: Record<string, string>) => ({
            token_id: item.token_id,
            title: item.title,
            owner_id: item.owner_id,
            tickets: extractTicketCount(item.title),
          }));
        } catch {
          setErrors(prev => new Map(prev).set(q.id, 'Ошибка'));
          return q.nfts;
        }
      }),
    );

    const updated = queries.map((q, i) => ({ ...q, nfts: results[i] }));
    onChange(updated);
    setLoading(false);

    // Auto-send overview, then collapse
    try { await sendOverview(updated); } catch {}
    onSearchDone(updated);
  };

  const ranges = getWalletRanges(queries);
  const totalTickets = ranges.length ? ranges[ranges.length - 1].end : 0;
  const hasResults = queries.some(q => q.nfts.length > 0);

  return (
    <div className="bg-gray-800 rounded-xl overflow-hidden">
      {/* Header — always visible */}
      <button
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-750 transition-colors"
        onClick={onToggle}
      >
        <span className="font-semibold text-gray-100">NFT / Билеты</span>
        <div className="flex items-center gap-3">
          {totalTickets > 0 && (
            <span className="text-xs text-gray-400">{ranges.length} кош. · {totalTickets} бил.</span>
          )}
          <span className="text-gray-400 text-lg font-light select-none">
            {isOpen ? '‹' : '›'}
          </span>
        </div>
      </button>

      {/* Collapsible content */}
      <div
        style={{
          display: 'grid',
          gridTemplateRows: isOpen ? '1fr' : '0fr',
          transition: 'grid-template-rows 0.3s ease',
        }}
      >
        <div className="overflow-hidden">
          <div className="px-5 pb-5 space-y-3">
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
                {queries.length > 1 && (
                  <button
                    className="px-3 py-2 bg-gray-700 hover:bg-red-800 rounded-lg text-sm transition-colors"
                    onClick={() => removeQuery(query.id)}
                  >
                    ✕
                  </button>
                )}
                {errors.get(query.id) && (
                  <span className="text-red-400 text-xs self-center">{errors.get(query.id)}</span>
                )}
              </div>
            ))}

            <button
              className="w-full py-1.5 border border-dashed border-gray-600 hover:border-gray-400 rounded-lg text-xs text-gray-500 hover:text-gray-300 transition-colors"
              onClick={addQuery}
            >
              + добавить поле
            </button>

            <button
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors"
              onClick={searchAll}
              disabled={loading || !queries.some(q => q.searchTitle.trim())}
            >
              {loading ? 'Поиск...' : 'Найти NFT'}
            </button>

            {/* Results */}
            {hasResults && (
              <div className="border border-gray-700 rounded-lg p-3 space-y-2 text-xs">
                <p className="font-medium text-gray-300">
                  Найдено: {queries.reduce((s, q) => s + q.nfts.length, 0)} NFT · {ranges.length} кошельков
                </p>
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
