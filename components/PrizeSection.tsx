'use client';

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
}

export default function PrizeSection({ prize, onChange, totalTickets, usedNumbers, onRaffle, sending }: Props) {
  const available = totalTickets - usedNumbers;
  const over = prize.count > available && available > 0;
  const canRaffle = available > 0 && !!prize.name.trim();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Приз</h2>
        {totalTickets > 0 && (
          <span className="text-xs text-gray-400">
            Доступно: <span className="text-white font-medium">{available}</span>
            {usedNumbers > 0 && ` (использовано: ${usedNumbers})`}
          </span>
        )}
      </div>

      <div className="space-y-2">
        <input
          className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          placeholder="Название приза (напр. Газировка 1 лвл)"
          value={prize.name}
          onChange={e => onChange({ ...prize, name: e.target.value })}
        />
        <div className="flex items-center gap-3">
          <input
            className="w-32 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-center focus:outline-none focus:border-blue-500"
            type="number"
            min={1}
            placeholder="Кол-во"
            value={prize.count}
            onChange={e => onChange({ ...prize, count: Math.max(1, parseInt(e.target.value) || 1) })}
          />
          {over && (
            <span className="text-yellow-400 text-xs">
              ⚠️ больше доступных — будет разыграно {available}
            </span>
          )}
        </div>
      </div>

      <button
        className="w-full py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-40 rounded-lg font-medium text-sm transition-colors"
        onClick={onRaffle}
        disabled={!canRaffle || sending}
      >
        {sending ? 'Отправка в TG...' : 'Провести розыгрыш'}
      </button>
    </div>
  );
}
