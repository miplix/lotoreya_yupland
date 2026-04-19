'use client';

import { useState, useRef } from 'react';

interface PrizeForm {
  name: string;
  count: number;
}

interface Props {
  prize: PrizeForm;
  onChange: (prize: PrizeForm) => void;
  totalTickets: number;
  usedNumbers: number;
  onRaffle: () => void;
  sending: boolean;
  isOpen: boolean;
  onToggle: () => void;
}

export default function PrizeSection({
  prize, onChange, totalTickets, usedNumbers, onRaffle, sending, isOpen, onToggle,
}: Props) {
  const [countStr, setCountStr] = useState(String(prize.count));
  const [shake, setShake] = useState(false);
  const countRef = useRef<HTMLInputElement>(null);

  const available = totalTickets - usedNumbers;
  const parsedCount = parseInt(countStr);
  const countEmpty = !countStr.trim();
  const countInvalid = countEmpty || isNaN(parsedCount) || parsedCount < 1;
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
    <div className="bg-gray-800 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-750 transition-colors"
        onClick={onToggle}
      >
        <span className="font-semibold text-gray-100">Приз</span>
        <div className="flex items-center gap-3">
          {totalTickets > 0 && (
            <span className="text-xs text-gray-400">
              Доступно: {available}
              {usedNumbers > 0 && ` · разыграно: ${usedNumbers}`}
            </span>
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
            <input
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              placeholder="Название приза"
              value={prize.name}
              onChange={e => onChange({ ...prize, name: e.target.value })}
            />

            <div className="flex items-center gap-3">
              <input
                ref={countRef}
                className={`w-32 bg-gray-700 rounded-lg px-3 py-2 text-sm text-center focus:outline-none transition-colors
                  ${countInvalid
                    ? 'border-2 border-red-500 focus:border-red-400'
                    : 'border border-gray-600 focus:border-blue-500'}
                  ${shake ? 'shake' : ''}`}
                type="number"
                min={1}
                placeholder="Кол-во"
                value={countStr}
                onChange={e => setCountStr(e.target.value)}
                onBlur={() => {
                  if (!countInvalid) onChange({ ...prize, count: parsedCount });
                }}
              />
              {over && (
                <span className="text-yellow-400 text-xs">
                  ⚠️ больше доступных — будет разыграно {available}
                </span>
              )}
            </div>

            <button
              className="w-full py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-40 rounded-lg font-medium text-sm transition-colors"
              onClick={handleRaffle}
              disabled={sending || available <= 0}
            >
              {sending ? 'Отправка в TG...' : 'Провести розыгрыш'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
