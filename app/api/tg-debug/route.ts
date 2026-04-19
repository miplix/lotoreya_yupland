import { NextResponse } from 'next/server';

const BOT_TOKEN = process.env.BOT_TOKEN ?? '';

export async function GET() {
  if (!BOT_TOKEN) return NextResponse.json({ error: 'BOT_TOKEN not set' }, { status: 500 });

  const [meRes, updRes] = await Promise.all([
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`),
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?limit=50`),
  ]);

  const me = await meRes.json();
  const upd = await updRes.json();

  // Extract unique chats from updates
  const chats = new Map<number, { id: number; type: string; title?: string; username?: string }>();
  for (const u of upd.result ?? []) {
    const chat = u.message?.chat ?? u.channel_post?.chat;
    if (chat) chats.set(chat.id, { id: chat.id, type: chat.type, title: chat.title, username: chat.username });
  }

  return NextResponse.json({
    bot: me.result,
    seen_chats: Array.from(chats.values()),
    raw_update_count: upd.result?.length ?? 0,
  });
}
