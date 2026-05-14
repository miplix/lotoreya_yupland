'use client';

import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { resolveImage } from '@/lib/image';

export interface TitleSuggestion {
  title: string;
  image: string | null;
  count: number;
}

interface Props {
  anchor: HTMLElement | null;
  items: TitleSuggestion[];
  onPick: (s: TitleSuggestion) => void;
}

interface Coords {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  flipped: boolean;
}

const MARGIN = 8;
const GAP = 4;

function computeCoords(anchor: HTMLElement): Coords {
  const r = anchor.getBoundingClientRect();
  const vh = window.innerHeight;
  const spaceBelow = vh - r.bottom - MARGIN;
  const spaceAbove = r.top - MARGIN;
  const flipped = spaceBelow < 220 && spaceAbove > spaceBelow;
  const maxHeight = Math.min(420, Math.max(180, flipped ? spaceAbove - GAP : spaceBelow - GAP));
  return {
    left: r.left,
    top: flipped ? r.top - maxHeight - GAP : r.bottom + GAP,
    width: r.width,
    maxHeight,
    flipped,
  };
}

export function SuggestionDropdown({ anchor, items, onPick }: Props) {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!anchor) return;
    const update = () => setCoords(computeCoords(anchor));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchor]);

  if (!mounted || !anchor || !coords || items.length === 0) return null;

  return createPortal(
    <ul
      role="listbox"
      style={{
        position: 'fixed',
        left: coords.left,
        top: coords.top,
        width: coords.width,
        maxHeight: coords.maxHeight,
        zIndex: 1000,
        WebkitOverflowScrolling: 'touch',
        overscrollBehavior: 'contain',
      }}
      className="bg-gray-800 border border-gray-600 rounded-lg shadow-xl overflow-y-auto text-sm"
      // onMouseDown on the container fires before input blur — keep the
      // suggestion open while the tap travels down to a child <li>.
      onMouseDown={e => e.preventDefault()}
    >
      {items.map(s => {
        const src = resolveImage(s.image);
        return (
          <li
            key={s.title}
            role="option"
            // Use click (works on touch + mouse). Don't preventDefault on
            // touchstart — that kills the scroll gesture on mobile.
            onClick={() => onPick(s)}
            className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-gray-700 active:bg-gray-700 transition-colors border-b border-gray-700/60 last:border-0"
          >
            {src ? (
              <img
                src={src}
                alt=""
                loading="lazy"
                className="w-9 h-9 rounded object-cover shrink-0 bg-gray-900"
                onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
              />
            ) : (
              <span className="w-9 h-9 rounded bg-gray-900 shrink-0" />
            )}
            <span className="flex-1 min-w-0 truncate text-gray-100">{s.title}</span>
            <span className="shrink-0 text-xs text-gray-400">×{s.count}</span>
          </li>
        );
      })}
    </ul>,
    document.body,
  );
}
