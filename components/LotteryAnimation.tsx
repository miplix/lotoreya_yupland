'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Winner } from '@/lib/types';

interface Entry { num: number; wallet: string; }

// ─── Individual spinning slot ────────────────────────────────────────────────

interface SlotProps {
  target: number;
  totalTickets: number;
  staggerMs: number;
  size: 'lg' | 'md' | 'sm';
  onLocked: () => void;
}

function Slot({ target, totalTickets, staggerMs, size, onLocked }: SlotProps) {
  const [display, setDisplay] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const cbRef = useRef(onLocked);
  cbRef.current = onLocked;
  const tRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const ivRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const arm = (fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms);
      tRefs.current.push(t);
      return t;
    };

    // Fast spin starts after stagger + 200ms
    arm(() => {
      ivRef.current = setInterval(() => {
        setDisplay(Math.floor(Math.random() * totalTickets) + 1);
      }, 35);
    }, staggerMs + 200);

    // After 1400ms of spinning → slow down
    arm(() => {
      if (ivRef.current !== null) { clearInterval(ivRef.current); ivRef.current = null; }
      const delays = [90, 140, 210, 300, 410];
      let i = 0;
      const tick = () => {
        setDisplay(Math.floor(Math.random() * totalTickets) + 1);
        i++;
        if (i < delays.length) {
          arm(tick, delays[i]);
        } else {
          setDisplay(target);
          setLocked(true);
          cbRef.current();
        }
      };
      arm(tick, delays[0]);
    }, staggerMs + 200 + 1400);

    return () => {
      tRefs.current.forEach(clearTimeout);
      tRefs.current = [];
      if (ivRef.current !== null) { clearInterval(ivRef.current); ivRef.current = null; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cls =
    size === 'lg' ? 'h-24 text-5xl' :
    size === 'md' ? 'h-20 text-4xl' :
                   'h-14 text-3xl';

  return (
    <div
      className={`w-full rounded-xl flex items-center justify-center border-2 bg-gray-900 transition-all ${cls}`}
      style={locked
        ? { borderColor: '#4ade80', boxShadow: '0 0 18px rgba(74,222,128,0.22)' }
        : { borderColor: '#374151' }}
    >
      <span
        className="font-black font-mono tabular-nums select-none transition-colors duration-200"
        style={{ color: locked ? '#4ade80' : '#f3f4f6' }}
      >
        {display ?? '—'}
      </span>
    </div>
  );
}

// ─── Main animation component ────────────────────────────────────────────────

interface Props {
  prizeLabel: string;
  totalTickets: number;
  winners: Winner[];
  simultaneousCount: number;
  onDone: () => void;
}

export default function LotteryAnimation({
  prizeLabel, totalTickets, winners, simultaneousCount, onDone,
}: Props) {
  const N = Math.max(1, Math.min(simultaneousCount, 10));

  const entries: Entry[] = useMemo(() =>
    winners
      .flatMap(w => w.winningNumbers.map(n => ({ num: n, wallet: w.wallet })))
      .sort((a, b) => a.num - b.num),
    [winners],
  );

  const [batchIdx, setBatchIdx] = useState(0);
  const [lockedCount, setLockedCount] = useState(0);
  const [revealed, setRevealed] = useState<Entry[]>([]);
  const [allDone, setAllDone] = useState(false);

  const batchStart = batchIdx * N;
  const currentBatch = entries.slice(batchStart, batchStart + N);
  const isLastBatch = batchStart + currentBatch.length >= entries.length;

  // Stable refs so timeout closures always see the latest values
  const currentBatchRef = useRef(currentBatch);
  currentBatchRef.current = currentBatch;
  const isLastBatchRef = useRef(isLastBatch);
  isLastBatchRef.current = isLastBatch;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup "done" timer on unmount
  useEffect(() => () => { if (doneTimerRef.current) clearTimeout(doneTimerRef.current); }, []);

  const handleSlotLocked = useCallback(() => setLockedCount(c => c + 1), []);

  useEffect(() => {
    if (currentBatch.length === 0 || lockedCount < currentBatch.length) return;

    const batch = [...currentBatchRef.current];
    const isLast = isLastBatchRef.current;

    const t = setTimeout(() => {
      setRevealed(prev => [...batch, ...prev]); // newest batch on top
      setLockedCount(0);
      if (isLast) {
        setAllDone(true);
        doneTimerRef.current = setTimeout(() => onDoneRef.current(), 2500);
      } else {
        setBatchIdx(b => b + 1);
      }
    }, 1800);

    return () => clearTimeout(t);
  }, [lockedCount, currentBatch.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (entries.length === 0) return null;

  // Grid columns: 1→1, 2→2, 3→3, 4→4, 5+→5
  const cols = Math.min(N, 5);
  const slotSize: 'lg' | 'md' | 'sm' =
    N === 1 ? 'lg' : N <= 3 ? 'md' : 'sm';

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/93 p-4 overflow-y-auto">
      <div className="w-full max-w-2xl flex flex-col items-center gap-4 py-4">

        {/* Header */}
        <div className="text-center shrink-0">
          <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-0.5">Розыгрыш</p>
          <h2 className="text-2xl font-bold text-white">{prizeLabel}</h2>
        </div>

        {!allDone ? (
          <>
            {/* Simultaneous slots grid */}
            <div
              className="w-full gap-2"
              style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)` }}
            >
              {currentBatch.map((entry, i) => (
                <Slot
                  key={`${batchIdx}-${i}`}
                  target={entry.num}
                  totalTickets={totalTickets}
                  staggerMs={i * 40}
                  size={slotSize}
                  onLocked={handleSlotLocked}
                />
              ))}
            </div>

            {/* Progress counter */}
            <p className="text-xs text-gray-600 shrink-0">
              {batchStart + 1}–{batchStart + currentBatch.length} / {entries.length}
            </p>
          </>
        ) : (
          <div className="text-center py-3 shrink-0">
            <p className="text-2xl font-bold text-green-400">Розыгрыш завершён</p>
            <p className="text-sm text-gray-500 mt-1">Результаты ниже</p>
          </div>
        )}

        {/* Revealed entries — newest batch first */}
        {revealed.length > 0 && (
          <div className="w-full max-h-56 overflow-y-auto space-y-1 shrink-0">
            {revealed.map((e, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm"
                style={{ background: 'rgba(31,41,55,0.85)' }}
              >
                <span className="font-mono font-bold text-green-400 shrink-0 w-14 text-right">
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
