'use client';

import { useState, useRef } from 'react';

interface PrizeForm {
  name: string;
  count: number;
  simultaneousCount: number;
}

interface Props {
  prize: PrizeForm;
  onChange: (prize: PrizeForm) => void;
  totalTickets: number;
  usedNumbers: number;
  onRaffle: () => void;
  sending: boolean;
}

export default function PrizeSection({
  prize, onChange, totalTickets, usedNumbers, onRaffle, sending,
}: Props) {
  const [countStr, setCountStr] = useState(String(prize.count));
  const [shake, setShake] = useState(false);
  const countRef = useRef<HTMLInputElement>(null);

  const available = totalTickets - usedNumbers;
  const parsedCount = parseInt(countStr);
  const countInvalid = !countStr.trim() || isNaN(parsedCount) || parsedCount < 1;
  const over = !countInvalid && parsedCount > available && available > 0;

  const handleRaffle = () => {
    if (countInvalid) {
      setShake(true);
      setTimeout(() => setShake(false), 450);
      countRef.current?.focus();
      return;
    }
    onChange({ ...prize, count: parsedCount });
    onRaffle();
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

      {/* Simultaneous count setting */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">Рандомно выбирать по:</span>
        <input
          type="number"
          min={1}
          max={10}
          className="w-14 bg-gray-700/80 border border-gray-600 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:border-blue-500"
          value={prize.simultaneousCount}
          onChange={e => {
            const v = Math.max(1, Math.min(10, parseInt(e.target.value) || 10));
            onChange({ ...prize, simultaneousCount: v });
          }}
        />
        <span className="text-xs text-gray-500">макс. 10</span>
      </div>

      {/* Prize form — stacks on mobile, row on sm+ */}
      <div className="flex flex-col gap-2 bg-gray-800/70 rounded-xl p-2">
        <input
          className="w-full bg-gray-700/80 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          placeholder="Название приза"
          value={prize.name}
          onChange={e => onChange({ ...prize, name: e.target.value })}
        />
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
            placeholder="Кол-во"
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

      {over && (
        <span className="text-yellow-400 text-xs">будет разыграно {available}</span>
      )}
    </div>
  );
}
