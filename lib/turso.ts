import { createClient, type Client } from '@libsql/client';

declare global {
  // eslint-disable-next-line no-var
  var __turso: Client | undefined;
}

export function turso(): Client {
  if (global.__turso) return global.__turso;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw new Error('TURSO_DATABASE_URL / TURSO_AUTH_TOKEN are not set');
  global.__turso = createClient({ url, authToken });
  return global.__turso;
}
