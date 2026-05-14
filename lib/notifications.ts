// Persistent toggle for automatic Telegram notifications.
// Manual "TG" buttons in history ignore this flag — they're explicit user
// intent. Only the auto-sends (search overview, post-draw result) check it.

const KEY = 'nft-lottery-notify-telegram';

export function getNotifyTelegram(): boolean {
  if (typeof window === 'undefined') return true;
  const v = window.localStorage.getItem(KEY);
  return v === null ? true : v === 'true';
}

export function setNotifyTelegram(value: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, String(value));
}
