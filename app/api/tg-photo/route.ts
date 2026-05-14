import { NextRequest, NextResponse } from 'next/server';

// Sends a single photo to the admin chat and returns the resulting message_id,
// so the caller can later place a 👍 reaction after the on-chain transfer.

const BOT_TOKEN = process.env.BOT_TOKEN ?? '';
const CHAT_ID = process.env.CHAT_ID ?? '';

export async function POST(request: NextRequest) {
  if (!BOT_TOKEN || !CHAT_ID) {
    return NextResponse.json({ error: 'BOT_TOKEN / CHAT_ID missing' }, { status: 500 });
  }
  const { photo, caption } = (await request.json()) as { photo?: string; caption?: string };
  if (!photo) return NextResponse.json({ error: 'photo required' }, { status: 400 });

  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        photo,
        caption: caption ?? '',
        parse_mode: 'HTML',
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      return NextResponse.json({ error: data.description ?? 'tg error' }, { status: 500 });
    }
    return NextResponse.json({
      messageId: data.result?.message_id ?? null,
      chatId: CHAT_ID,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown' }, { status: 500 });
  }
}
