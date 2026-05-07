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

interface TitleSuggestion { title: string; image: string | null; count: number; }
interface ScanState {
  lastSkip: number;
  totalSeen: number;
  lastScannedAt: string | null;
  uniqueTitles: number;
}

export default function NFTSection({ queries, onChange, onSearchDone }: Props) {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [copied, setCopied] = useState(false);
  // IDs of queries that passed the silent 1-sec debounce check (≥1 NFT found)
  const [validated, setValidated] = useState<Set<string>>(new Set());
  // Autocomplete suggestions per query (sourced from Turso collection_titles)
  const [suggestions, setSuggestions] = useState<Map<string, TitleSuggestion[]>>(new Map());
  const [activeSuggestionFor, setActiveSuggestionFor] = useState<string | null>(null);
  // Shared scan state from Turso (same row golden-drop uses)
  const [scanState, setScanState] = useState<ScanState | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string>('');
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const suggestTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Cleanup timers on unmount
  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    suggestTimers.current.forEach(clearTimeout);
  }, []);

  // Load shared scan state on mount
  useEffect(() => {
    fetch('/api/nft-scan').then(r => r.json()).then(setScanState).catch(() => {});
  }, []);

  const runScan = async () => {
    if (scanning) return;
    setScanning(true);
    setScanMessage('Сканирую...');
    try {
      // Loop until end of collection or 5 batches done — keeps Vercel timeout safe per call
      for (let i = 0; i < 20; i++) {
        const res = await fetch('/api/nft-scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pages: 5, resume: true }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setScanState(prev => ({
          lastSkip: data.lastSkip,
          totalSeen: data.totalSeen,
          lastScannedAt: new Date().toISOString(),
          uniqueTitles: prev?.uniqueTitles ?? 0,
        }));
        setScanMessage(
          `Прогон ${i + 1}: +${data.itemsThisRun} NFT, обновлено title: ${data.titlesAddedOrUpdated}, всего: ${data.totalSeen}`,
        );
        if (data.endOfCollection) {
          setScanMessage(`Готово. Всего NFT: ${data.totalSeen}.`);
          break;
        }
      }
      // refresh title count
      const fresh = await fetch('/api/nft-scan').then(r => r.json());
      setScanState(fresh);
    } catch (e) {
      setScanMessage(`Ошибка: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setScanning(false);
    }
  };

  const addQuery = () =>
    onChange([...queries, { id: crypto.randomUUID(), searchTitle: '', nfts: [] }]);

  const removeQuery = (id: string) => {
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
    const st = suggestTimers.current.get(id);
    if (st) { clearTimeout(st); suggestTimers.current.delete(id); }
    setValidated(prev => { const s = new Set(prev); s.delete(id); return s; });
    setSuggestions(prev => { const m = new Map(prev); m.delete(id); return m; });
    if (activeSuggestionFor === id) setActiveSuggestionFor(null);
    onChange(queries.filter(q => q.id !== id));
  };

  const updateTitle = (id: string, title: string) => {
    onChange(queries.map(q => (q.id === id ? { ...q, searchTitle: title } : q)));

    // Reset checkmark for this field
    setValidated(prev => { const s = new Set(prev); s.delete(id); return s; });

    // Clear existing timers
    const existing = timers.current.get(id);
    if (existing) clearTimeout(existing);
    const existingSuggest = suggestTimers.current.get(id);
    if (existingSuggest) clearTimeout(existingSuggest);

    if (!title.trim()) {
      setSuggestions(prev => { const m = new Map(prev); m.delete(id); return m; });
      return;
    }

    // Fast: pull suggestions from Turso (debounce 200ms) and confirm validation if exact match exists
    const suggestTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/nft-titles?q=${encodeURIComponent(title.trim())}&limit=10`);
        const data = await res.json();
        const items: TitleSuggestion[] = data.items ?? [];
        setSuggestions(prev => new Map(prev).set(id, items));
        setActiveSuggestionFor(id);
        const lower = title.trim().toLowerCase();
        if (items.some(it => it.title.toLowerCase() === lower)) {
          setValidated(prev => new Set(prev).add(id));
        }
      } catch { /* silent */ }
    }, 200);
    suggestTimers.current.set(id, suggestTimer);

    // Slow fallback: live Sendler check after 1s (kept as second-line confirmation)
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

  const pickSuggestion = (id: string, suggestion: TitleSuggestion) => {
    onChange(queries.map(q => (q.id === id ? { ...q, searchTitle: suggestion.title } : q)));
    setValidated(prev => new Set(prev).add(id));
    setActiveSuggestionFor(null);
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
        Начните вводить
      </p>

      {/* Shared NFT cache control (same scan_state row golden-drop uses in Turso) */}
      <div className="flex items-center justify-between gap-2 text-xs bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-gray-300">
            Кэш NFT: <span className="text-white font-medium">{scanState?.uniqueTitles ?? '—'}</span>{' '}
            <span className="text-gray-500">видов</span>
            {' · '}
            <span className="text-gray-400">{scanState?.totalSeen ?? '—'}</span>{' '}
            <span className="text-gray-500">шт</span>
          </div>
          <div className="text-gray-500 truncate">
            {scanMessage ||
              (scanState?.lastScannedAt
                ? `обновлено ${new Date(scanState.lastScannedAt).toLocaleString('ru-RU')}`
                : 'ещё не сканировалось')}
          </div>
        </div>
        <button
          onClick={runScan}
          disabled={scanning}
          className="shrink-0 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded-lg text-xs transition-colors"
          title="Подгружает новые NFT с Sendler API в общий кэш (Turso)"
        >
          {scanning ? '...' : 'Подгрузить'}
        </button>
      </div>

      {queries.map(query => (
        <div key={query.id} className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              placeholder="Название NFT для поиска"
              value={query.searchTitle}
              onChange={e => updateTitle(query.id, e.target.value)}
              onFocus={() => {
                if ((suggestions.get(query.id) ?? []).length > 0) setActiveSuggestionFor(query.id);
              }}
              onBlur={() => setTimeout(() => {
                setActiveSuggestionFor(prev => (prev === query.id ? null : prev));
              }, 150)}
              onKeyDown={e => {
                if (e.key === 'Enter') searchAll();
                if (e.key === 'Escape') setActiveSuggestionFor(null);
              }}
            />
            {activeSuggestionFor === query.id && (suggestions.get(query.id) ?? []).length > 0 && (
              <ul className="absolute z-20 left-0 right-0 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl max-h-72 overflow-y-auto text-sm">
                {(suggestions.get(query.id) ?? []).map(s => (
                  <li
                    key={s.title}
                    onMouseDown={e => { e.preventDefault(); pickSuggestion(query.id, s); }}
                    className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-gray-700 transition-colors"
                  >
                    {s.image ? (
                      <img src={s.image} alt="" className="w-7 h-7 rounded object-cover shrink-0 bg-gray-900" />
                    ) : (
                      <span className="w-7 h-7 rounded bg-gray-900 shrink-0" />
                    )}
                    <span className="flex-1 min-w-0 truncate text-gray-100">{s.title}</span>
                    <span className="shrink-0 text-xs text-gray-400">×{s.count}</span>
                  </li>
                ))}
              </ul>
            )}
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
