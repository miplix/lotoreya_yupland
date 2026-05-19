'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { NFTQuery, NFTItem } from '@/lib/types';
import { extractTicketCount } from '@/lib/nft-parser';
import { getWalletRanges } from '@/lib/lottery';
import { SuggestionDropdown, type TitleSuggestion } from './SuggestionDropdown';

interface Props {
  queries: NFTQuery[];
  onChange: (queries: NFTQuery[]) => void;
  onSearchDone: (updatedQueries: NFTQuery[]) => void;
  /** When false the "search overview" message to Telegram is skipped. */
  notifyTelegram?: boolean;
}

async function sendOverview(queries: NFTQuery[]): Promise<void> {
  const ranges = getWalletRanges(queries);
  const total = ranges.length ? ranges[ranges.length - 1].end : 0;
  const lines = [`Всего билетов: ${total}`, ''];
  for (const { wallet, tickets, start, end } of ranges) {
    lines.push(`${wallet} — ${tickets} билетов (${start}–${end})`);
  }
  await fetch('/lotoreya/api/send-to-telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: lines.join('\n') }),
  });
}

interface ScanState {
  lastSkip: number;
  totalSeen: number;
  lastScannedAt: string | null;
  uniqueTitles: number;
}

const MAX_SUGGESTIONS = 500;

export default function NFTSection({ queries, onChange, onSearchDone, notifyTelegram = true }: Props) {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [copied, setCopied] = useState(false);
  // IDs of queries that passed validation (≥1 NFT in cache or via Sendler fallback)
  const [validated, setValidated] = useState<Set<string>>(new Set());
  // Local cache of all collection titles — pulled once, filtered client-side (instant)
  const [allTitles, setAllTitles] = useState<TitleSuggestion[]>([]);
  // Which input id is currently showing suggestions; anchor element for portal positioning
  const [activeSuggestionFor, setActiveSuggestionFor] = useState<string | null>(null);
  const [activeAnchor, setActiveAnchor] = useState<HTMLElement | null>(null);
  // Shared scan state from Turso (same row golden-drop uses)
  const [scanState, setScanState] = useState<ScanState | null>(null);
  const [scanning, setScanning] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const inputRefs = useRef<Map<string, HTMLInputElement | null>>(new Map());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Cleanup timers on unmount
  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
  }, []);

  // Preload the full title list once — 1797 rows ≈ 150 KB; filter is local after that.
  const refreshTitleCache = async () => {
    try {
      const res = await fetch('/lotoreya/api/nft-titles?limit=2000');
      const data = await res.json();
      setAllTitles(data.items ?? []);
    } catch { /* silent */ }
  };

  useEffect(() => {
    refreshTitleCache();
    fetch('/lotoreya/api/nft-scan').then(r => r.json()).then(setScanState).catch(() => {});
  }, []);

  const runScan = async () => {
    if (scanning) return;
    setScanning(true);
    try {
      for (let i = 0; i < 20; i++) {
        const res = await fetch('/lotoreya/api/nft-scan', {
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
        if (data.endOfCollection) break;
      }
      const fresh = await fetch('/lotoreya/api/nft-scan').then(r => r.json());
      setScanState(fresh);
      await refreshTitleCache();
    } catch { /* silent */ }
    finally {
      setScanning(false);
    }
  };

  const addQuery = () =>
    onChange([...queries, { id: crypto.randomUUID(), searchTitle: '', nfts: [] }]);

  const removeQuery = (id: string) => {
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
    setValidated(prev => { const s = new Set(prev); s.delete(id); return s; });
    inputRefs.current.delete(id);
    if (activeSuggestionFor === id) {
      setActiveSuggestionFor(null);
      setActiveAnchor(null);
    }
    onChange(queries.filter(q => q.id !== id));
  };

  // Filter from in-memory cache — instant, runs on every keystroke
  const suggestionsFor = useMemo(() => {
    return (raw: string): TitleSuggestion[] => {
      const q = raw.trim().toLowerCase();
      if (!q) return [];
      const out: TitleSuggestion[] = [];
      for (const t of allTitles) {
        if (t.title.toLowerCase().includes(q)) {
          out.push(t);
          if (out.length >= MAX_SUGGESTIONS) break;
        }
      }
      return out;
    };
  }, [allTitles]);

  const updateTitle = (id: string, title: string) => {
    onChange(queries.map(q => (q.id === id ? { ...q, searchTitle: title } : q)));

    // Instant validation: exact case-insensitive match against the cache
    const lower = title.trim().toLowerCase();
    const exact = !!lower && allTitles.some(t => t.title.toLowerCase() === lower);
    setValidated(prev => {
      const s = new Set(prev);
      if (exact) s.add(id); else s.delete(id);
      return s;
    });

    if (title.trim()) {
      const anchor = inputRefs.current.get(id);
      if (anchor) setActiveAnchor(anchor);
      setActiveSuggestionFor(id);
    } else {
      setActiveSuggestionFor(prev => (prev === id ? null : prev));
    }

    // Slow fallback for titles missing from the cache (e.g. brand-new collections)
    const existing = timers.current.get(id);
    if (existing) clearTimeout(existing);
    if (!title.trim() || exact) return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/lotoreya/api/search-nft?title=${encodeURIComponent(title.trim())}`);
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
    setActiveAnchor(null);
  };

  const searchAll = async () => {
    if (!queries.some(q => q.searchTitle.trim())) return;
    setLoading(true);
    setErrors(new Map());

    const results = await Promise.all(
      queries.map(async (q): Promise<NFTItem[]> => {
        if (!q.searchTitle.trim()) return q.nfts;
        try {
          const res = await fetch(`/lotoreya/api/search-nft?title=${encodeURIComponent(q.searchTitle)}`);
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
    if (notifyTelegram) {
      try { await sendOverview(updated); } catch {}
    }
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

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-yellow-400 tracking-wide">
          Начните вводить
        </p>
        <div className="flex items-center gap-1.5 shrink-0 relative">
          <button
            type="button"
            onClick={() => setShowHelp(v => !v)}
            onBlur={() => setTimeout(() => setShowHelp(false), 150)}
            aria-label="Подсказка"
            className="text-gray-500 hover:text-gray-200 text-xs w-4 h-4 rounded-full border border-gray-600 flex items-center justify-center transition-colors"
          >
            ?
          </button>
          {showHelp && (
            <div className="absolute right-0 top-6 z-30 w-60 text-[11px] leading-relaxed bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-2.5 text-gray-300">
              Список NFT хранится в общей базе для всех админов. Сканируй только если нужного NFT нет в выпадающем списке — это добавит новые.
            </div>
          )}
          <button
            type="button"
            onClick={runScan}
            disabled={scanning}
            className="px-2.5 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded-md text-xs transition-colors"
          >
            {scanning ? '…' : 'Сканировать'}
          </button>
        </div>
      </div>

      {queries.map(query => (
        <div key={query.id} className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              ref={el => { inputRefs.current.set(query.id, el); }}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2.5 text-base sm:text-sm focus:outline-none focus:border-blue-500"
              placeholder="Название NFT для поиска"
              value={query.searchTitle}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              onChange={e => updateTitle(query.id, e.target.value)}
              onFocus={e => {
                if (query.searchTitle.trim()) {
                  setActiveAnchor(e.currentTarget);
                  setActiveSuggestionFor(query.id);
                }
              }}
              onBlur={() => setTimeout(() => {
                setActiveSuggestionFor(prev => {
                  if (prev === query.id) {
                    setActiveAnchor(null);
                    return null;
                  }
                  return prev;
                });
              }, 150)}
              onKeyDown={e => {
                if (e.key === 'Enter') searchAll();
                if (e.key === 'Escape') {
                  setActiveSuggestionFor(null);
                  setActiveAnchor(null);
                }
              }}
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

      {activeSuggestionFor && (
        <SuggestionDropdown
          anchor={activeAnchor}
          items={suggestionsFor(queries.find(q => q.id === activeSuggestionFor)?.searchTitle ?? '')}
          onPick={s => pickSuggestion(activeSuggestionFor, s)}
        />
      )}

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
