// Безопасный UUID. `crypto.randomUUID` есть НЕ во всех webview — в старых
// Android/Telegram (и не-secure-context) его нет → вызов кидал client-side
// exception и роняло всю страницу («работает на ПК, на телефоне нет»).
// Фоллбэк на Math.random работает везде.
export function uid(): string {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof (crypto as Crypto).randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore — падаем в фоллбэк */
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
