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

// Заголовок приза. Для токенов показываем per-winner amount × кол-во
// участников ("100 HOPE × 8"). Для NFT — просто "Lantern × 8".
function prizeHeader(p: Prize): string {
  if (p.kind === 'token' && p.tokenAmount != null && p.tokenAmount > 0) {
    return `${p.tokenAmount} ${p.name} × ${p.count}`;
  }
  return `${p.name} × ${p.count}`;
}

function prizeHeaderHtml(p: Prize): string {
  if (p.kind === 'token' && p.tokenAmount != null && p.tokenAmount > 0) {
    return `${p.tokenAmount} ${escapeHtml(p.name)} × ${p.count}`;
  }
  return `${escapeHtml(p.name)} × ${p.count}`;
}

// Plain text version — used for the on-screen result modal
export function formatRaffleText(result: RaffleResult): string {
  const header = result.prizes.map(prizeHeader).join(' + ');
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
  const header = result.prizes.map(prizeHeaderHtml).join(' + ');
  const lines = [header, ''];
  for (const w of result.winners) {
    lines.push(`<code>${escapeHtml(w.wallet)}</code> — ${w.prizeCount} шт     ${w.winningNumbers.join(', ')}`);
  }
  return lines.join('\n');
}

// Подпись к CSV-документу в личных чатах админов. Короткая, HTML.
//   "Раздача токенов: <b>100 HOPE</b> × 8 победителей"
//   "Раздача NFT: <b>Lantern (Common)</b> × 8 победителей"
export function formatCsvCaptionHtml(result: RaffleResult): string {
  const winners = result.winners.length;
  const parts = result.prizes.map((p) => {
    if (p.kind === 'token' && p.tokenAmount != null && p.tokenAmount > 0) {
      return `Раздача токенов: <b>${p.tokenAmount} ${escapeHtml(p.name)}</b> × ${p.count}`;
    }
    return `Раздача NFT: <b>${escapeHtml(p.name)}</b> × ${p.count}`;
  });
  return `${parts.join(' + ')}\nПобедителей: ${winners}`;
}
