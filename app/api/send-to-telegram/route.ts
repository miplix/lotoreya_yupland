import { NextRequest, NextResponse } from 'next/server';

const BOT_TOKEN = process.env.BOT_TOKEN ?? '';
const CHAT_ID = process.env.CHAT_ID ?? '';
const CSV_RECIPIENTS = (process.env.CSV_RECIPIENT_IDS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

async function tgPost(
  method: string,
  body: FormData | Record<string, unknown>,
): Promise<{ message_id?: number }> {
  const isForm = body instanceof FormData;
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    ...(isForm
      ? { body }
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(await res.text());
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: { message_id?: number };
  };
  return json.result ?? {};
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 1500): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}

export async function POST(request: NextRequest) {
  const { text, parseMode, csvString, filename } = (await request.json()) as {
    text: string;
    parseMode?: 'HTML' | 'MarkdownV2' | 'Markdown';
    csvString?: string;
    filename?: string;
  };

  if (!BOT_TOKEN) {
    return NextResponse.json({ error: 'BOT_TOKEN not set' }, { status: 500 });
  }

  const errors: string[] = [];
  // deliveries — per-recipient (chatId, messageId) для CSV, чтобы потом
  // PayoutPanel мог поставить 👍 на эту же сообщение, а не слать второй файл.
  const deliveries: Array<{ chatId: string; messageId: number }> = [];

  // 1. Text message → group chat
  if (CHAT_ID && text) {
    try {
      const payload: Record<string, unknown> = { chat_id: CHAT_ID, text };
      if (parseMode) payload.parse_mode = parseMode;
      await tgPost('sendMessage', payload);
    } catch (e) {
      errors.push(`group message: ${e instanceof Error ? e.message : e}`);
    }
  }

  // 2. CSV document → each private recipient (only if CSV provided), with retry
  if (csvString && filename) {
    for (const userId of CSV_RECIPIENTS) {
      try {
        const result = await withRetry(async () => {
          const form = new FormData();
          form.append('chat_id', userId);
          form.append('document', new Blob([csvString], { type: 'text/csv' }), filename);
          return await tgPost('sendDocument', form);
        });
        if (typeof result.message_id === 'number') {
          deliveries.push({ chatId: userId, messageId: result.message_id });
        }
      } catch (e) {
        errors.push(`CSV to ${userId}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  if (errors.length) {
    console.error('Telegram errors:', errors);
    return NextResponse.json({ errors, deliveries }, { status: 500 });
  }

  return NextResponse.json({ success: true, deliveries });
}
