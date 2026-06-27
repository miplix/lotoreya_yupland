// YupLink Wallet — коннект + подпись выплат через НАШ кошелёк.
//
// Кошелёк с /wallet/sign (golden-drop) живёт на service.yupland.io — ТОТ ЖЕ
// origin, что и лотерея (service.yupland.io/lotoreya). Поэтому iframe подписи —
// same-origin: видит то же IndexedDB-хранилище кошелька, что и приложение, в
// котором ты открыл лотерею (в Telegram-мини-аппе там твой darai_collection.near).
// NB: yupland.io — это ДРУГОЕ приложение (платформа Yupland) без /wallet/sign,
// туда направлять нельзя.
//
// Окно подписи открывается ОВЕРЛЕЕМ (iframe) прямо в лотерее — без перехода и
// без нового окна (важно в мини-аппе). YupLink подписывает ПОЛНЫМ ключом
// (с deposit), broadcast'ит и редиректит iframe на нашу мост-страницу
// /wallet-callback, которая postMessage'ит результат родителю (лотерее).

const WALLET_BASE = "https://service.yupland.io";
const SIGNER = "darai_collection.near"; // кошелёк-оператор лотереи

// UTF-8 → стандартный base64 (совместимо с decodeBase64Json в /wallet/sign).
function encodeTxs(value: unknown): string {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export interface YupLinkWallet {
  accountId: string;
  walletObj: {
    signAndSendTransactions: (args: {
      transactions: Array<{ receiverId: string; actions: unknown[] }>;
    }) => Promise<{ transactionHashes: string[] }>;
  };
}

/** «Подключение» оператора: аккаунт известен (SIGNER), подпись — через iframe-оверлей. */
export function getYupLinkWallet(): YupLinkWallet {
  return {
    accountId: SIGNER,
    walletObj: {
      signAndSendTransactions: ({ transactions }) =>
        signViaYupLink(transactions),
    },
  };
}

function signViaYupLink(
  transactions: Array<{ receiverId: string; actions: unknown[] }>
): Promise<{ transactionHashes: string[] }> {
  // near-connect формат { receiverId, actions } → MNW { signerId, receiverId, actions }
  const mnw = transactions.map((t) => ({
    signerId: SIGNER,
    receiverId: t.receiverId,
    actions: t.actions,
  }));
  const b64 = encodeTxs(mnw);
  // basePath лотереи = /lotoreya, origin = service.yupland.io
  const callbackUrl = `${window.location.origin}/lotoreya/wallet-callback`;
  const url =
    `${WALLET_BASE}/wallet/sign` +
    `?transactions=${encodeURIComponent(b64)}` +
    `&callbackUrl=${encodeURIComponent(callbackUrl)}`;

  // ── Оверлей с iframe: окно подписи прямо поверх лотереи, без перехода ──
  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    background: "rgba(0,0,0,0.72)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "10px",
  } as CSSStyleDeclaration);
  const box = document.createElement("div");
  Object.assign(box.style, {
    position: "relative",
    width: "min(460px, 96vw)",
    height: "min(840px, 94vh)",
    borderRadius: "16px",
    overflow: "hidden",
    background: "#0b0f1a",
    boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
  } as CSSStyleDeclaration);
  const frame = document.createElement("iframe");
  frame.src = url;
  frame.allow = "clipboard-read; clipboard-write";
  Object.assign(frame.style, {
    width: "100%",
    height: "100%",
    border: "0",
    background: "#0b0f1a",
  } as CSSStyleDeclaration);
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Закрыть");
  closeBtn.textContent = "✕";
  Object.assign(closeBtn.style, {
    position: "absolute",
    top: "8px",
    right: "10px",
    zIndex: "2",
    width: "30px",
    height: "30px",
    padding: "0",
    lineHeight: "30px",
    borderRadius: "50%",
    border: "0",
    background: "rgba(0,0,0,0.55)",
    color: "#fff",
    fontSize: "15px",
    cursor: "pointer",
  } as CSSStyleDeclaration);
  box.appendChild(frame);
  box.appendChild(closeBtn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  return new Promise((resolve, reject) => {
    let done = false;
    const cleanup = () => {
      window.removeEventListener("message", onMsg);
      overlay.remove();
    };
    const onMsg = (e: MessageEvent) => {
      const d = e.data as
        | { type?: string; transactionHashes?: string; error?: string }
        | undefined;
      if (!d || d.type !== "yuplink-sign-result") return;
      done = true;
      cleanup();
      if (d.error) reject(new Error(d.error));
      else
        resolve({
          transactionHashes: String(d.transactionHashes || "")
            .split(",")
            .filter(Boolean),
        });
    };
    const cancel = () => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error("Окно подписи закрыто"));
    };
    closeBtn.addEventListener("click", cancel);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cancel();
    });
    window.addEventListener("message", onMsg);
  });
}
