import { NextRequest, NextResponse } from 'next/server';

// Sends a private text message to every admin in CSV_RECIPIENT_IDS and
// returns the resulting (chatId, messageId) pairs so the caller can later
// drop a 👍 reaction once the on-chain payout succeeds.
// Never touches the public CHAT_ID.

const BOT_TOKEN = process.env.BOT_TOKEN ?? '';
const ADMIN_IDS = (process.env.CSV_RECIPIENT_IDS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

interface Delivery { chatId: string; messageId: number | null; error?: string; }

export async function POST(request: NextRequest) {
  if (!BOT_TOKEN) {
    return NextResponse.json({ error: 'BOT_TOKEN missing' }, { status: 500 });
  }
  if (ADMIN_IDS.length === 0) {
    return NextResponse.json({ error: 'CSV_RECIPIENT_IDS empty' }, { status: 500 });
  }
  const { text } = (await request.json()) as { text?: string };
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 });

  const deliveries: Delivery[] = [];
  for (const chatId of ADMIN_IDS) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
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
