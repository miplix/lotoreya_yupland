import { NextRequest, NextResponse } from 'next/server';

async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function middleware(request: NextRequest) {
  const accessKey = process.env.ACCESS_KEY;
  // No key configured → no gate (dev mode)
  if (!accessKey) return NextResponse.next();

  const session = request.cookies.get('session')?.value;
  const expected = await hashKey(accessKey);

  if (session !== expected) {
    const url = request.nextUrl.clone();
    url.pathname = '/watch';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// Only protect the main lottery page
export const config = { matcher: ['/'] };
