import { NextRequest, NextResponse } from 'next/server';

// Telegram-webhook бота лотереи.
// Логика: если админ (CSV_RECIPIENT_IDS) пишет в личку бота — копируем
// сообщение в публичную группу (CHAT_ID) методом copyMessage.
// copyMessage не показывает источник ("переслано от X"), поэтому пост
// выглядит так, будто его написал сам бот.

const BOT_TOKEN = process.env.BOT_TOKEN ?? '';
const CHAT_ID = process.env.CHAT_ID ?? '';
const ADMIN_IDS = new Set(
  (process.env.CSV_RECIPIENT_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

interface TgChat {
  id: number;
  type: string;
}

interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  channel_post?: TgMessage;
}

async function tgApi(
  method: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function POST(request: NextRequest) {
  if (!BOT_TOKEN || !CHAT_ID) {
    return NextResponse.json(
      { error: 'BOT_TOKEN / CHAT_ID not set' },
      { status: 500 },
    );
  }

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  // Принимаем только обычные сообщения (не edits, не channel posts).
  const msg = update.message;
  if (!msg) return NextResponse.json({ ok: true });

  // Только в личке (приваты) — групповые сообщения игнорим.
  if (msg.chat.type !== 'private') return NextResponse.json({ ok: true });

  const senderId = msg.from?.id;
  if (!senderId) return NextResponse.json({ ok: true });

  // Allowlist по user_id — только админы.
  if (!ADMIN_IDS.has(String(senderId))) {
    // Тихо игнорим, чтобы не подсказывать чужим что бот что-то умеет.
    return NextResponse.json({ ok: true });
  }

  // Команды боту обрабатываем отдельно.
  if (msg.text === '/start') {
    await tgApi('sendMessage', {
      chat_id: msg.chat.id,
      text:
        'Привет 👋\n\n' +
        'Всё что напишешь сюда — отправлю в группу лотереи от имени бота.\n' +
        'Текст, фото, видео, документ — что угодно.\n\n' +
        'Используй /help чтобы посмотреть подсказку ещё раз.',
    });
    return NextResponse.json({ ok: true });
  }
  if (msg.text === '/help') {
    await tgApi('sendMessage', {
      chat_id: msg.chat.id,
      text: 'Просто отправь сюда сообщение — оно появится в группе лотереи от имени бота.',
    });
    return NextResponse.json({ ok: true });
  }

  // Копируем сообщение в публичную группу. copyMessage сохраняет формат,
  // подписи, реакции на медиа — но БЕЗ "переслано от Х".
  const copy = await tgApi('copyMessage', {
    chat_id: CHAT_ID,
    from_chat_id: msg.chat.id,
    message_id: msg.message_id,
  });

  if (copy.ok) {
    await tgApi('sendMessage', {
      chat_id: msg.chat.id,
      text: '✅ Опубликовано в группе.',
      reply_to_message_id: msg.message_id,
    });
  } else {
    await tgApi('sendMessage', {
      chat_id: msg.chat.id,
      text: `⚠️ Не удалось опубликовать: ${copy.description ?? 'unknown error'}`,
      reply_to_message_id: msg.message_id,
    });
  }

  return NextResponse.json({ ok: true });
}

// Telegram запрашивает HEAD/GET при первичной валидации — отвечаем 200.
export async function GET() {
  return NextResponse.json({
    ok: true,
    name: 'lotoreya_yupland_bot webhook',
  });
}
