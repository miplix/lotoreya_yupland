// YupLink Wallet — коннект + подпись выплат через НАШ кошелёк.
//
// Оператор лотереи подписывает выплату в интерфейсе YupLink-кошелька:
// открываем попап на service.yupland.io/wallet/sign?transactions=<base64>,
// оператор выбирает свой embedded-кош (darai_collection.near) + PIN, наш кош
// подписывает ПОЛНЫМ ключом (с deposit) и broadcast'ит, затем редиректит на
// нашу мост-страницу /wallet-callback, которая postMessage'ит результат
// обратно в окно лотереи.
//
// Реюз готового MNW-совместимого /wallet/sign — без крипто-кода в лотерее.

const WALLET_BASE = "https://service.yupland.io";
const SIGNER = "darai_collection.near"; // кошелёк-оператор лотереи

// UTF-8 → стандартный base64 (совместимо с decodeBase64Json в /wallet/sign:
// atob → байты → TextDecoder('utf-8')).
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

/** «Подключение» оператора: аккаунт известен (SIGNER), подпись — через /wallet/sign. */
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
  const callbackUrl = `${window.location.origin}/wallet-callback`;
  const url =
    `${WALLET_BASE}/wallet/sign` +
    `?transactions=${encodeURIComponent(b64)}` +
    `&callbackUrl=${encodeURIComponent(callbackUrl)}`;

  const popup = window.open(url, "yuplink-sign", "width=460,height=780");
  if (!popup) {
    return Promise.reject(
      new Error("Попап заблокирован — разреши всплывающие окна и повтори")
    );
  }

  return new Promise((resolve, reject) => {
    let done = false;
    const cleanup = () => {
      window.removeEventListener("message", onMsg);
      clearInterval(poll);
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
    const poll = setInterval(() => {
      if (popup.closed && !done) {
        cleanup();
        reject(new Error("Окно подписи закрыто без результата"));
      }
    }, 700);
    window.addEventListener("message", onMsg);
  });
}
