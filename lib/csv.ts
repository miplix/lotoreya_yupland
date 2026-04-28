import { RaffleResult, Prize } from './types';

export function generateCSV(result: RaffleResult): string {
  const rows = ['wallet,count', ...result.csvData.map(({ wallet, count }) => `${wallet},${count}`)];
  return rows.join('\n');
}

export function downloadCSV(csvString: string, filename: string): void {
  const blob = new Blob([csvString], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// "Газировка 1 лвл" × 50  →  "Газировка_1_лвл_50.csv"
export function makeFilename(prizes: Prize[]): string {
  return prizes.map(p => `${p.name.trim().replace(/\s+/g, '_')}_${p.count}`).join('_') + '.csv';
}

// Plain text version — used for the on-screen result modal
export function formatRaffleText(result: RaffleResult): string {
  const header = result.prizes.map(p => `${p.name} × ${p.count}`).join(' + ');
  const lines = [header, ''];
  for (const w of result.winners) {
    lines.push(`${w.wallet} — ${w.prizeCount} шт     ${w.winningNumbers.join(', ')}`);
  }
  return lines.join('\n');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// HTML version for Telegram — wraps each wallet in <code> so a tap copies it
export function formatRaffleTextHtml(result: RaffleResult): string {
  const header = result.prizes.map(p => `${escapeHtml(p.name)} × ${p.count}`).join(' + ');
  const lines = [header, ''];
  for (const w of result.winners) {
    lines.push(`<code>${escapeHtml(w.wallet)}</code> — ${w.prizeCount} шт     ${w.winningNumbers.join(', ')}`);
  }
  return lines.join('\n');
}
