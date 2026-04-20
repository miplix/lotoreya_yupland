import { NextRequest, NextResponse } from 'next/server';

async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const COOKIE = 'session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 дней

export async function POST(request: NextRequest) {
  const { key } = (await request.json()) as { key: string };
  const accessKey = process.env.ACCESS_KEY;

  if (!accessKey) {
    return NextResponse.json({ error: 'ACCESS_KEY не настроен' }, { status: 500 });
  }
  if (!key || key !== accessKey) {
    return NextResponse.json({ error: 'Неверный ключ' }, { status: 401 });
  }

  const token = await hashKey(accessKey);
  const res = NextResponse.json({ success: true });
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: MAX_AGE,
    path: '/',
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ success: true });
  res.cookies.delete(COOKIE);
  return res;
}
