import { NextRequest, NextResponse } from 'next/server';

// Places a 👍 (or arbitrary emoji) reaction on a previously posted message.
// Used after a successful on-chain prize payout to mark the corresponding
// NFT photo as "delivered".

const BOT_TOKEN = process.env.BOT_TOKEN ?? '';
const CHAT_ID = process.env.CHAT_ID ?? '';

export async function POST(request: NextRequest) {
  if (!BOT_TOKEN) {
    return NextResponse.json({ error: 'BOT_TOKEN missing' }, { status: 500 });
  }
  const { messageId, emoji } = (await request.json()) as { messageId?: number; emoji?: string };
  if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 });

  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setMessageReaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        message_id: messageId,
        reaction: [{ type: 'emoji', emoji: emoji ?? '👍' }],
        is_big: false,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      return NextResponse.json({ error: data.description ?? 'tg error' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown' }, { status: 500 });
  }
}
