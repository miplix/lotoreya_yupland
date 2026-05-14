import { NextRequest, NextResponse } from 'next/server';

// Places 👍 reactions on previously posted messages — one call per
// (chatId, messageId) pair. Used after a successful on-chain payout
// to mark the corresponding NFT photo as delivered in each admin's
// private chat.

const BOT_TOKEN = process.env.BOT_TOKEN ?? '';

interface ReactTarget { chatId: string; messageId: number; }

export async function POST(request: NextRequest) {
  if (!BOT_TOKEN) {
    return NextResponse.json({ error: 'BOT_TOKEN missing' }, { status: 500 });
  }
  const { targets, emoji } = (await request.json()) as { targets?: ReactTarget[]; emoji?: string };
  if (!Array.isArray(targets) || targets.length === 0) {
    return NextResponse.json({ error: 'targets required' }, { status: 400 });
  }

  const results: Array<{ chatId: string; messageId: number; ok: boolean; error?: string }> = [];
  for (const t of targets) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setMessageReaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: t.chatId,
          message_id: t.messageId,
          reaction: [{ type: 'emoji', emoji: emoji ?? '👍' }],
          is_big: false,
        }),
      });
      const data = await res.json();
      results.push({
        chatId: t.chatId,
        messageId: t.messageId,
        ok: !!data.ok,
        error: data.ok ? undefined : (data.description ?? 'tg error'),
      });
    } catch (e) {
      results.push({
        chatId: t.chatId,
        messageId: t.messageId,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return NextResponse.json({ results });
}
