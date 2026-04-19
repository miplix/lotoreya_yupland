'use client';

import { Prize } from '@/lib/types';

interface Props {
  prizes: Prize[];
  onChange: (prizes: Prize[]) => void;
  totalTickets: number;
}

export default function PrizeSection({ prizes, onChange, totalTickets }: Props) {
  const totalPrizes = prizes.reduce((s, p) => s + p.count, 0);
  const overLimit = totalTickets > 0 && totalPrizes > totalTickets;

  const addPrize = () =>
    onChange([...prizes, { id: crypto.randomUUID(), name: '', count: 1 }]);

  const removePrize = (id: string) => onChange(prizes.filter(p => p.id !== id));

  const update = (id: string, field: 'name' | 'count', value: string | number) =>
    onChange(prizes.map(p => (p.id === id ? { ...p, [field]: value } : p)));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Призы</h2>
        <span className={`text-sm ${overLimit ? 'text-yellow-400' : 'text-gray-400'}`}>
          Всего: {totalPrizes}
          {totalTickets > 0 && ` / ${totalTickets} билетов`}
          {overLimit && ' ⚠️ будет ограничено'}
        </span>
      </div>

      {prizes.map(prize => (
        <div key={prize.id} className="flex gap-2">
          <input
            className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
            placeholder="Название приза"
            value={prize.name}
            onChange={e => update(prize.id, 'name', e.target.value)}
          />
          <input
            className="w-20 bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-center focus:outline-none focus:border-blue-500"
            type="number"
            min={1}
            value={prize.count}
            onChange={e => update(prize.id, 'count', Math.max(1, parseInt(e.target.value) || 1))}
          />
          <button
            className="px-3 py-1.5 bg-gray-700 hover:bg-red-800 rounded text-sm transition-colors"
            onClick={() => removePrize(prize.id)}
          >
            ✕
          </button>
        </div>
      ))}

      <button
        className="w-full py-2 border border-dashed border-gray-600 hover:border-gray-400 rounded-lg text-sm text-gray-400 hover:text-gray-200 transition-colors"
        onClick={addPrize}
      >
        + Добавить приз
      </button>
    </div>
  );
}
