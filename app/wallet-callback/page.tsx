"use client";

import { useEffect, useState } from "react";

// Мост для подписи через YupLink-кош. /wallet/sign после подписи редиректит
// сюда: ?transactionHashes=h1,h2  (успех)  или  ?errorCode=…&errorMessage=…
// (отказ). Шлём результат в окно-открыватель (лотерея) через postMessage и
// закрываемся. Если открыто не как попап — просто показываем статус.
export default function WalletCallback() {
  const [status, setStatus] = useState("Обработка…");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const transactionHashes = q.get("transactionHashes") || "";
    const errorCode = q.get("errorCode") || "";
    const errorMessage = q.get("errorMessage") || "";
    const error = errorCode ? errorMessage || errorCode : "";

    const msg = { type: "yuplink-sign-result", transactionHashes, error };
    // iframe-оверлей → шлём РОДИТЕЛЮ (window.parent); попап (фоллбэк) → opener.
    const target =
      window.parent && window.parent !== window ? window.parent : window.opener;
    try {
      if (target) target.postMessage(msg, "*");
    } catch {
      /* ignore */
    }
    setStatus(
      error
        ? `Отклонено: ${error}`
        : transactionHashes
          ? "Подписано ✓"
          : "Готово."
    );
    // Попап закрываем сами; iframe убирает родитель (overlay.remove), там close() — no-op.
    const t = setTimeout(() => {
      try {
        if (window.opener) window.close();
      } catch {
        /* ignore */
      }
    }, 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
        color: "#cbd5e1",
        background: "#0b0f17",
        textAlign: "center",
        padding: 24,
      }}
    >
      {status}
    </div>
  );
}
