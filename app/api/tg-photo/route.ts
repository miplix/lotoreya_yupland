import { NextRequest, NextResponse } from 'next/server';

// Sends an NFT photo to every admin listed in CSV_RECIPIENT_IDS (private
// chats only — never to the public CHAT_ID). Returns the message_id from
// each delivery so the caller can later place a 👍 reaction once the
// on-chain transfer succeeds.

const BOT_TOKEN = process.env.BOT_TOKEN ?? '';
const ADMIN_IDS = (process.env.CSV_RECIPIENT_IDS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

interface Delivery {
  chatId: string;
  messageId: number | null;
  error?: string;
}

export async function POST(request: NextRequest) {
  if (!BOT_TOKEN) {
    return NextResponse.json({ error: 'BOT_TOKEN missing' }, { status: 500 });
  }
  if (ADMIN_IDS.length === 0) {
    return NextResponse.json({ error: 'CSV_RECIPIENT_IDS empty' }, { status: 500 });
  }
  const { photo, caption } = (await request.json()) as { photo?: string; caption?: string };
  if (!photo) return NextResponse.json({ error: 'photo required' }, { status: 400 });

  const deliveries: Delivery[] = [];
  for (const chatId of ADMIN_IDS) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          photo,
          caption: caption ?? '',
          parse_mode: 'HTML',
        }),
      });
      const data = await res.json();
      if (data.ok) {
        deliveries.push({ chatId, messageId: data.result?.message_id ?? null });
      } else {
        deliveries.push({ chatId, messageId: null, error: data.description ?? 'tg error' });
      }
    } catch (e) {
      deliveries.push({ chatId, messageId: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ deliveries });
}
