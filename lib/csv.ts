import { RaffleResult } from './types';

export function generateCSV(result: RaffleResult): string {
  const rows = [
    'wallet,count',
    ...result.csvData.map(({ wallet, count }) => `${wallet},${count}`),
  ];
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
