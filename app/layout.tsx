import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  title: 'NFT Lottery Raffle',
  description: 'NFT-based lottery for Yupland collections',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        {/* Telegram WebApp SDK — нужен для CloudStorage (стабильное хранение
            админ-ключа в мини-аппе, чтобы пароль вводился один раз). В обычном
            браузере просто no-op. */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
      </head>
      <body className="bg-slate-700 text-gray-100 antialiased">{children}</body>
    </html>
  );
}
