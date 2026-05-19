'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { SuggestionDropdown, type TitleSuggestion } from './SuggestionDropdown';

export type PrizeKind = 'nft' | 'token';

export interface PrizeForm {
  kind: PrizeKind;
  name: string;          // NFT title OR FT symbol
  count: number;         // number of winning slots
  simultaneousCount: number;
  tokenAmount?: number;  // per-winner amount (only for kind === 'token')
}

interface RewardToken {
  symbol: string;
  ftContract: string;
  decimals: number;
  sortOrder: number;
}

interface Props {
  prize: PrizeForm;
  onChange: (prize: PrizeForm) => void;
  totalTickets: number;
  usedNumbers: number;
  onRaffle: () => void;
  sending: boolean;
  /** Connected NEAR account. Token rewards and on-chain payouts are gated to the collection signer. */
  walletAccount?: string | null;
}

const COLLECTION_SIGNER = 'darai_collection.near';

export default function PrizeSection({
  prize, onChange, totalTickets, usedNumbers, onRaffle, sending, walletAccount,
}: Props) {
  const [countStr, setCountStr] = useState(String(prize.count));
  const [shake, setShake] = useState(false);
  const countRef = useRef<HTMLInputElement>(null);

  // Title autocomplete (same Turso cache the NFT search uses)
  const [allTitles, setAllTitles] = useState<TitleSuggestion[]>([]);
  const [titleAnchor, setTitleAnchor] = useState<HTMLInputElement | null>(null);
  const [titleFocused, setTitleFocused] = useState(false);

  // Token list (Turso reward_tokens)
  const [tokens, setTokens] = useState<RewardToken[]>([]);

  // Per-winner amount input (string, validated on raffle)
  const [amountStr, setAmountStr] = useState(prize.tokenAmount ? String(prize.tokenAmount) : '');

  const isSigner = walletAccount === COLLECTION_SIGNER;

  useEffect(() => {
    fetch('/lotoreya/api/nft-titles?limit=2000').then(r => r.json()).then(d => setAllTitles(d.items ?? [])).catch(() => {});
    fetch('/lotoreya/api/reward-tokens').then(r => r.json()).then(d => setTokens(d.items ?? [])).catch(() => {});
  }, []);

  // Force NFT mode (without amount) when token features are not allowed
  useEffect(() => {
    if (!isSigner && prize.kind === 'token') {
      onChange({ ...prize, kind: 'nft', tokenAmount: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSigner]);

  const available = totalTickets - usedNumbers;
  const parsedCount = parseInt(countStr);
  const countInvalid = !countStr.trim() || isNaN(parsedCount) || parsedCount < 1;
  const over = !countInvalid && parsedCount > available && available > 0;

  const parsedAmount = parseFloat(amountStr);
  const amountInvalid = prize.kind === 'token' && (!amountStr.trim() || isNaN(parsedAmount) || parsedAmount <= 0);

  // Filtered NFT title suggestions (instant, client-side)
  const titleSuggestions = useMemo(() => {
    if (prize.kind !== 'nft') return [] as TitleSuggestion[];
    const q = prize.name.trim().toLowerCase();
    if (!q) return [];
    const out: TitleSuggestion[] = [];
    for (const t of allTitles) {
      if (t.title.toLowerCase().includes(q)) {
        out.push(t);
        if (out.length >= 500) break;
      }
    }
    return out;
  }, [prize.kind, prize.name, allTitles]);

  const handleRaffle = () => {
    if (countInvalid) {
      setShake(true);
      setTimeout(() => setShake(false), 450);
      countRef.current?.focus();
      return;
    }
    if (amountInvalid) {
      setShake(true);
      setTimeout(() => setShake(false), 450);
      return;
    }
    onChange({
      ...prize,
      count: parsedCount,
      tokenAmount: prize.kind === 'token' ? parsedAmount : undefined,
    });
    onRaffle();
  };

  const setKind = (kind: PrizeKind) => {
    if (kind === prize.kind) return;
    if (kind === 'token' && !isSigner) return;
    onChange({
      ...prize,
      kind,
      name: '',
      tokenAmount: kind === 'token' ? prize.tokenAmount : undefined,
    });
    setAmountStr(kind === 'token' && prize.tokenAmount ? String(prize.tokenAmount) : '');
  };

  return (
    <div className="p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Приз</h2>
        {totalTickets > 0 && (
          <span className="text-xs text-gray-400">
            Доступно: <span className="text-white font-medium">{available}</span>
            {usedNumbers > 0 && ` · разыграно: ${usedNumbers}`}
          </span>
        )}
      </div>

      {/* Kind switcher — token rewards are gated to the collection signer wallet */}
      {isSigner && (
        <div className="flex items-center gap-1 bg-gray-800/60 rounded-lg p-1 w-fit">
          <button
            type="button"
            onClick={() => setKind('nft')}
            className={`px-3 py-1 rounded-md text-xs transition-colors ${
              prize.kind === 'nft' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >NFT</button>
          <button
            type="button"
            onClick={() => setKind('token')}
            className={`px-3 py-1 rounded-md text-xs transition-colors ${
              prize.kind === 'token' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >Токен</button>
        </div>
      )}

      {/* Simultaneous count setting */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">Рандомно выбирать по:</span>
        <input
          type="number"
          min={1}
          max={50}
          className="w-14 bg-gray-700/80 border border-gray-600 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:border-blue-500"
          value={prize.simultaneousCount}
          onChange={e => {
            const v = Math.max(1, Math.min(50, parseInt(e.target.value) || 10));
            onChange({ ...prize, simultaneousCount: v });
          }}
        />
        <span className="text-xs text-gray-500">макс. 50</span>
      </div>

      {/* Prize form */}
      <div className="flex flex-col gap-2 bg-gray-800/70 rounded-xl p-2">
        {prize.kind === 'nft' ? (
          <input
            ref={el => setTitleAnchor(el)}
            className="w-full bg-gray-700/80 border border-gray-600 rounded-lg px-3 py-2.5 text-base sm:text-sm focus:outline-none focus:border-blue-500"
            placeholder="Название NFT"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={prize.name}
            onChange={e => onChange({ ...prize, name: e.target.value })}
            onFocus={() => setTitleFocused(true)}
            onBlur={() => setTimeout(() => setTitleFocused(false), 150)}
          />
        ) : (
          <div className="flex gap-2">
            <select
              className="flex-1 bg-gray-700/80 border border-gray-600 rounded-lg px-3 py-2.5 text-base sm:text-sm focus:outline-none focus:border-blue-500"
              value={prize.name}
              onChange={e => onChange({ ...prize, name: e.target.value })}
            >
              <option value="">— токен —</option>
              {tokens.map(t => (
                <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
              ))}
            </select>
            <input
              className="w-28 bg-gray-700/80 border border-gray-600 rounded-lg px-2 py-2.5 text-sm text-center focus:outline-none focus:border-blue-500"
              type="number"
              min={0}
              step="any"
              placeholder="Кол-во"
              value={amountStr}
              onChange={e => setAmountStr(e.target.value)}
              onBlur={() => {
                const n = parseFloat(amountStr);
                if (!isNaN(n) && n > 0) onChange({ ...prize, tokenAmount: n });
              }}
            />
          </div>
        )}

        <div className="flex gap-2">
          <input
            ref={countRef}
            className={`w-24 shrink-0 bg-gray-700/80 rounded-lg px-2 py-2 text-sm text-center focus:outline-none transition-colors
              ${countInvalid
                ? 'border-2 border-red-500 focus:border-red-400'
                : 'border border-gray-600 focus:border-blue-500'}
              ${shake ? 'shake' : ''}`}
            type="number"
            min={1}
            placeholder="Призов"
            value={countStr}
            onChange={e => setCountStr(e.target.value)}
            onBlur={() => { if (!countInvalid) onChange({ ...prize, count: parsedCount }); }}
          />
          <button
            className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-40 rounded-lg font-medium text-sm transition-colors"
            onClick={handleRaffle}
            disabled={sending || available <= 0}
          >
            {sending ? 'Отправка...' : 'Провести розыгрыш'}
          </button>
        </div>
      </div>

      {/* NFT autocomplete dropdown (portal-rendered, same as in NFTSection) */}
      {prize.kind === 'nft' && titleFocused && (
        <SuggestionDropdown
          anchor={titleAnchor}
          items={titleSuggestions}
          onPick={s => {
            onChange({ ...prize, name: s.title });
            setTitleFocused(false);
          }}
        />
      )}

      {over && (
        <span className="text-yellow-400 text-xs">будет разыграно {available}</span>
      )}
      {prize.kind === 'token' && parsedAmount > 0 && parsedCount > 0 && (
        <span className="text-[11px] text-gray-500">
          Будет роздано до {parsedAmount * parsedCount} {prize.name || '—'} среди {parsedCount} выигрышных позиций
        </span>
      )}
    </div>
  );
}
