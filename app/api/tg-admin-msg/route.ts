import { NextRequest, NextResponse } from 'next/server';

// Sends a private message to every admin in CSV_RECIPIENT_IDS. Two modes:
//   1. text-only (sendMessage) — pass { text }
//   2. CSV document (sendDocument) — pass { text, csvString, filename }
// Returns the resulting (chatId, messageId) for each admin so the caller
// can later place a 👍 reaction once the on-chain payout finishes.
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
  const { text, csvString, filename } = (await request.json()) as {
    text?: string;
    csvString?: string;
    filename?: string;
  };

  const useDocument = !!csvString;
  if (!useDocument && !text) {
    return NextResponse.json({ error: 'text or csvString required' }, { status: 400 });
  }

  const deliveries: Delivery[] = [];
  for (const chatId of ADMIN_IDS) {
    try {
      let messageId: number | null = null;
      let error: string | undefined;
      if (useDocument) {
        const form = new FormData();
        form.append('chat_id', chatId);
        form.append('document', new Blob([csvString!], { type: 'text/csv' }), filename ?? 'winners.csv');
        if (text) {
          form.append('caption', text);
          form.append('parse_mode', 'HTML');
        }
        const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
          method: 'POST',
          body: form,
        });
        const data = await res.json();
        if (data.ok) messageId = data.result?.message_id ?? null;
        else error = data.description ?? 'tg error';
      } else {
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
        if (data.ok) messageId = data.result?.message_id ?? null;
        else error = data.description ?? 'tg error';
      }
      deliveries.push({ chatId, messageId, error });
    } catch (e) {
      deliveries.push({ chatId, messageId: null, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ deliveries });
}
