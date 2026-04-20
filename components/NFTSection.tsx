'use client';

import { useState, useRef, useEffect } from 'react';
import { NFTQuery, NFTItem } from '@/lib/types';
import { extractTicketCount } from '@/lib/nft-parser';
import { getWalletRanges } from '@/lib/lottery';

interface Props {
  queries: NFTQuery[];
  onChange: (queries: NFTQuery[]) => void;
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

export default function NFTSection({ queries, onChange, onSearchDone }: Props) {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [copied, setCopied] = useState(false);
  // IDs of queries that passed the silent 1-sec debounce check (≥1 NFT found)
  const [validated, setValidated] = useState<Set<string>>(new Set());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Cleanup timers on unmount
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const addQuery = () =>
    onChange([...queries, { id: crypto.randomUUID(), searchTitle: '', nfts: [] }]);

  const removeQuery = (id: string) => {
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
    setValidated(prev => { const s = new Set(prev); s.delete(id); return s; });
    onChange(queries.filter(q => q.id !== id));
  };

  const updateTitle = (id: string, title: string) => {
    onChange(queries.map(q => (q.id === id ? { ...q, searchTitle: title } : q)));

    // Reset checkmark for this field
    setValidated(prev => { const s = new Set(prev); s.delete(id); return s; });

    // Clear existing debounce timer
    const existing = timers.current.get(id);
    if (existing) clearTimeout(existing);

    if (!title.trim()) return;

    // Schedule silent check after 1 s
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search-nft?title=${encodeURIComponent(title.trim())}`);
        const data = await res.json();
        if ((data.items ?? []).length > 0) {
          setValidated(prev => new Set(prev).add(id));
        }
      } catch { /* silent */ }
    }, 1000);

    timers.current.set(id, timer);
  };

  const searchAll = async () => {
    if (!queries.some(q => q.searchTitle.trim())) return;
    setLoading(true);
    setErrors(new Map());

    const results = await Promise.all(
      queries.map(async (q): Promise<NFTItem[]> => {
        if (!q.searchTitle.trim()) return q.nfts;
        try {
          const res = await fetch(`/api/search-nft?title=${encodeURIComponent(q.searchTitle)}`);
          if (!res.ok) throw new Error();
          const data = await res.json();
          return (data.items ?? []).map((item: Record<string, string>) => ({
            token_id: item.token_id,
            title: item.title,
            owner_id: item.owner_id,
            tickets: extractTicketCount(item.title),
            media: item.media,
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
    try { await sendOverview(updated); } catch {}
    onSearchDone(updated);
  };

  const ranges = getWalletRanges(queries);
  const totalTickets = ranges.length ? ranges[ranges.length - 1].end : 0;
  const hasResults = queries.some(q => q.nfts.length > 0);

  return (
    <div className="p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">NFT / Билеты</h2>
        {totalTickets > 0 && (
          <span className="text-xs text-gray-400">{ranges.length} кош. · {totalTickets} бил.</span>
        )}
      </div>

      <p className="text-sm font-semibold text-yellow-400 tracking-wide">
        Вводите полное название NFT — неполное название не найдёт кошельки
      </p>

      {queries.map(query => (
        <div key={query.id} className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              placeholder="Название NFT для поиска"
              value={query.searchTitle}
              onChange={e => updateTitle(query.id, e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchAll()}
            />
          </div>

          {/* Green checkmark — appears after debounce confirms ≥1 NFT found */}
          <span
            className="text-green-400 text-xl font-bold transition-opacity duration-300 select-none"
            style={{ opacity: validated.has(query.id) ? 1 : 0, minWidth: '1.25rem' }}
          >
            ✓
          </span>

          {queries.length > 1 && (
            <button
              className="px-3 py-2 bg-gray-700 hover:bg-red-800 rounded-lg text-sm transition-colors shrink-0"
              onClick={() => removeQuery(query.id)}
            >✕</button>
          )}

          {errors.get(query.id) && (
            <span className="text-red-400 text-xs shrink-0">{errors.get(query.id)}</span>
          )}
        </div>
      ))}

      <button
        className="w-full py-1.5 border border-dashed border-gray-600 hover:border-gray-400 rounded-lg text-xs text-gray-500 hover:text-gray-300 transition-colors"
        onClick={addQuery}
      >+ добавить поле</button>

      <button
        className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors"
        onClick={searchAll}
        disabled={loading || !queries.some(q => q.searchTitle.trim())}
      >
        {loading ? 'Поиск...' : 'Найти NFT'}
      </button>

      {hasResults && (
        <div className="border border-gray-700 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 gap-2">
            <span className="text-xs text-gray-400 min-w-0 truncate">{ranges.length} уч. · {totalTickets} бил.</span>
            <div className="flex gap-1.5 shrink-0">
              <button
                className="px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
                onClick={() => {
                  const text = ranges.map(r => `${r.wallet},${r.tickets}`).join('\n');
                  navigator.clipboard.writeText(text)
                    .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
                    .catch(() => {});
                }}
                style={{ minWidth: '7rem' }}
              >{copied ? '✓ Скопировано' : 'Копировать'}</button>
              <button
                className="px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
                onClick={() => {
                  const csv = 'address,count\n' + ranges.map(r => `${r.wallet},${r.tickets}`).join('\n');
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
                  a.download = `participants-${Date.now()}.csv`;
                  a.click();
                }}
              >CSV ↓</button>
            </div>
          </div>
          <div className="p-3 space-y-1 text-xs max-h-52 overflow-y-auto">
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
  );
}
