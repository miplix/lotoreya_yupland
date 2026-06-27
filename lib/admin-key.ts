// Хранение админ-ключа лотереи для авто-входа («ввёл пароль один раз → дальше
// само»). Пишем в ДВА места:
//   • Telegram CloudStorage — переживает переоткрытие мини-аппа (в Telegram
//     localStorage часто обнуляется при каждом запуске webview);
//   • localStorage — для обычного браузера.
// Ключ есть только у того, кто раз ввёл пароль = у админа.

const KEY = 'lotoreya-admin-key';

/* eslint-disable @typescript-eslint/no-explicit-any */
function tgCloud(): any | null {
  try {
    const cs = (window as any)?.Telegram?.WebApp?.CloudStorage;
    return cs && typeof cs.getItem === 'function' ? cs : null;
  } catch {
    return null;
  }
}

function ls(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export async function saveAdminKey(key: string): Promise<void> {
  ls()?.setItem(KEY, key);
  const cs = tgCloud();
  if (cs) {
    try {
      cs.setItem(KEY, key, () => {});
    } catch {
      /* ignore */
    }
  }
}

export function loadAdminKey(): Promise<string | null> {
  const local = ls()?.getItem(KEY) ?? null;
  const cs = tgCloud();
  if (!cs) return Promise.resolve(local);
  // CloudStorage асинхронный + может зависнуть — таймаут с фоллбэком на localStorage.
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      resolve(v || local);
    };
    const t = setTimeout(() => finish(local), 1500);
    try {
      cs.getItem(KEY, (err: unknown, value: string) => {
        clearTimeout(t);
        finish(!err && value ? value : null);
      });
    } catch {
      clearTimeout(t);
      finish(local);
    }
  });
}

export async function clearAdminKey(): Promise<void> {
  ls()?.removeItem(KEY);
  const cs = tgCloud();
  if (cs) {
    try {
      cs.removeItem(KEY, () => {});
    } catch {
      /* ignore */
    }
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
