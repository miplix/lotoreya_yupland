import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NFT Lottery Raffle',
  description: 'NFT-based lottery for Yupland collections',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="bg-gray-900 text-gray-100 antialiased">{children}</body>
    </html>
  );
}
