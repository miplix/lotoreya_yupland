'use client';

import { useEffect, useRef, useState } from 'react';
import { Winner } from '@/lib/types';

interface Entry { num: number; wallet: string; }

interface Props {
  prizeLabel: string;
  totalTickets: number;
  winners: Winner[];
  onDone: () => void;
}

export default function LotteryAnimation({ prizeLabel, totalTickets, winners, onDone }: Props) {
  // Flatten all winning numbers and sort so we reveal them in ascending order
  const entries: Entry[] = winners
    .flatMap(w => w.winningNumbers.map(n => ({ num: n, wallet: w.wallet })))
    .sort((a, b) => a.num - b.num);

  const [step, setStep] = useState(0);
  const [display, setDisplay] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const [revealed, setRevealed] = useState<Entry[]>([]);
  const [allDone, setAllDone] = useState(false);

  const tRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const ivRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const arm = (fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    tRefs.current.push(t);
  };

  const clearAll = () => {
    tRefs.current.forEach(clearTimeout);
    tRefs.current = [];
    if (ivRef.current !== null) { clearInterval(ivRef.current); ivRef.current = null; }
  };

  useEffect(() => {
    if (entries.length === 0) { onDone(); return; }

    if (step >= entries.length) {
      setAllDone(true);
      arm(onDone, 3000);
      return clearAll;
    }

    const target = entries[step].num;
    setDisplay(null);
    setLocked(false);

    // Brief pause, then start fast spin
    arm(() => {
      ivRef.current = setInterval(() => {
        setDisplay(Math.floor(Math.random() * totalTickets) + 1);
      }, 35);
    }, 300);

    // Stop fast spin after 1400ms, enter slow-down
    arm(() => {
      if (ivRef.current !== null) { clearInterval(ivRef.current); ivRef.current = null; }

      // Each entry: delay before next tick (ms). Numbers slow down visibly.
      const steps = [90, 140, 210, 300, 410];
      let i = 0;
      const tick = () => {
        setDisplay(Math.floor(Math.random() * totalTickets) + 1);
        i++;
        if (i < steps.length) {
          arm(tick, steps[i]);
        } else {
          // Lock on the winning number
          setDisplay(target);
          setLocked(true);

          // Show wallet for 1500ms, then add to list and move to next
          arm(() => {
            setRevealed(prev => [{ num: target, wallet: entries[step].wallet }, ...prev]);
            arm(() => setStep(s => s + 1), 800);
          }, 1500);
        }
      };
      arm(tick, steps[0]);
    }, 1400);

    return clearAll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const current = step < entries.length ? entries[step] : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/93 p-6 overflow-y-auto">
      <div className="w-full max-w-md flex flex-col items-center gap-5 py-6">

        {/* Header */}
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Розыгрыш</p>
          <h2 className="text-2xl font-bold text-white">{prizeLabel}</h2>
        </div>

        {!allDone ? (
          <>
            {/* Slot machine display */}
            <div
              className="w-60 h-32 rounded-2xl flex items-center justify-center border-2 transition-all duration-300 bg-gray-900"
              style={locked
                ? { borderColor: '#4ade80', boxShadow: '0 0 60px rgba(74,222,128,0.25)' }
                : { borderColor: '#374151' }}
            >
              <span
                className="text-7xl font-black font-mono tabular-nums select-none transition-colors duration-200"
                style={{ color: locked ? '#4ade80' : '#f3f4f6' }}
              >
                {display ?? '—'}
              </span>
            </div>

            {/* Wallet revealed after lock */}
            <div className="h-12 flex flex-col items-center justify-center">
              {locked && current && (
                <div className="text-center px-4 animate-pulse">
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-0.5">Победитель</p>
                  <p className="text-base font-semibold text-green-300 break-all leading-tight">
                    {current.wallet}
                  </p>
                </div>
              )}
            </div>

            {/* Progress */}
            <p className="text-xs text-gray-600">{step + 1} / {entries.length}</p>
          </>
        ) : (
          <div className="text-center py-4">
            <p className="text-2xl font-bold text-green-400 mb-1">Розыгрыш завершён</p>
            <p className="text-sm text-gray-500">Результаты ниже</p>
          </div>
        )}

        {/* Revealed list (newest first) */}
        {revealed.length > 0 && (
          <div className="w-full space-y-1.5 max-h-52 overflow-y-auto">
            {revealed.map((e, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm"
                style={{ background: 'rgba(31,41,55,0.8)' }}
              >
                <span className="font-mono font-bold text-green-400 shrink-0 w-12 text-right">
                  {e.num}
                </span>
                <span className="text-gray-300 truncate">{e.wallet}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
