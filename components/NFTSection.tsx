'use client';

import { useState } from 'react';
import { NFTQuery, NFTItem } from '@/lib/types';
import { extractTicketCount } from '@/lib/nft-parser';
import { aggregateWalletTickets } from '@/lib/lottery';

interface Props {
  queries: NFTQuery[];
  onChange: (queries: NFTQuery[]) => void;
}

export default function NFTSection({ queries, onChange }: Props) {
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());

  const addQuery = () =>
    onChange([...queries, { id: crypto.randomUUID(), searchTitle: '', nfts: [] }]);

  const removeQuery = (id: string) => onChange(queries.filter(q => q.id !== id));

  const updateTitle = (id: string, title: string) =>
    onChange(queries.map(q => (q.id === id ? { ...q, searchTitle: title } : q)));

  const searchNFTs = async (query: NFTQuery) => {
    if (!query.searchTitle.trim()) return;
    setLoadingIds(prev => new Set(prev).add(query.id));
    setErrors(prev => { const m = new Map(prev); m.delete(query.id); return m; });

    try {
      const res = await fetch(`/api/search-nft?title=${encodeURIComponent(query.searchTitle)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const nfts: NFTItem[] = (data.items ?? []).map((item: Record<string, string>) => ({
        token_id: item.token_id,
        title: item.title,
        owner_id: item.owner_id,
        tickets: extractTicketCount(item.title),
      }));

      onChange(queries.map(q => (q.id === query.id ? { ...q, nfts } : q)));
    } catch {
      setErrors(prev => new Map(prev).set(query.id, 'Ошибка загрузки'));
    } finally {
      setLoadingIds(prev => { const s = new Set(prev); s.delete(query.id); return s; });
    }
  };

  const walletMap = aggregateWalletTickets(queries);
  const totalTickets = Array.from(walletMap.values()).reduce((s, v) => s + v, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">NFT / Билеты</h2>
        <span className="text-sm text-gray-400">
          {walletMap.size} кошельков · {totalTickets} билетов
        </span>
      </div>

      {queries.map(query => (
        <div key={query.id} className="border border-gray-700 rounded-lg p-3 space-y-2">
          <div className="flex gap-2">
            <input
              className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
              placeholder="Название NFT для поиска"
              value={query.searchTitle}
              onChange={e => updateTitle(query.id, e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchNFTs(query)}
            />
            <button
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm disabled:opacity-40 transition-colors"
              onClick={() => searchNFTs(query)}
              disabled={loadingIds.has(query.id) || !query.searchTitle.trim()}
            >
              {loadingIds.has(query.id) ? '...' : 'Найти'}
            </button>
            <button
              className="px-3 py-1.5 bg-gray-700 hover:bg-red-800 rounded text-sm transition-colors"
              onClick={() => removeQuery(query.id)}
            >
              ✕
            </button>
          </div>

          {errors.get(query.id) && (
            <p className="text-red-400 text-xs">{errors.get(query.id)}</p>
          )}

          {query.nfts.length > 0 && (
            <div className="text-xs text-gray-400">
              <p className="text-gray-300 mb-1 font-medium">
                Найдено: {query.nfts.length} NFT
              </p>
              <div className="max-h-40 overflow-y-auto space-y-0.5">
                {query.nfts.map(nft => (
                  <div key={nft.token_id} className="flex justify-between gap-2 py-0.5">
                    <span className="truncate" title={nft.title}>{nft.title}</span>
                    <span className="shrink-0 text-gray-300">
                      {nft.owner_id.length > 24 ? nft.owner_id.slice(0, 22) + '…' : nft.owner_id}
                      {' · '}<span className="text-blue-400">{nft.tickets}т</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      <button
        className="w-full py-2 border border-dashed border-gray-600 hover:border-gray-400 rounded-lg text-sm text-gray-400 hover:text-gray-200 transition-colors"
        onClick={addQuery}
      >
        + Добавить поиск NFT
      </button>

      {walletMap.size > 0 && (
        <div className="text-xs border-t border-gray-700 pt-3 space-y-1">
          <p className="font-medium text-gray-300">Сводка по кошелькам:</p>
          <div className="max-h-36 overflow-y-auto space-y-0.5">
            {Array.from(walletMap.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([wallet, tickets]) => (
                <div key={wallet} className="flex justify-between gap-2 text-gray-400">
                  <span className="truncate">{wallet}</span>
                  <span className="shrink-0 text-blue-400">{tickets} билетов</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
