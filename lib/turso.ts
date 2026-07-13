// БД-адаптер: ПРЯМОЙ Postgres к нашей серверной базе (selfhost-db, схема
// yuplink — общая с golden-drop). Supabase убран по требованию владельца:
// «только сервер, всё через нашу базу». Интерфейс execute({sql,args})
// сохранён (libsql-совместимый), поэтому app/api/* НЕ меняются.
import { Pool } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function pool(): Pool {
  if (global.__pgPool) return global.__pgPool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL not set');
  global.__pgPool = new Pool({
    connectionString,
    // Таблицы лотереи (reward_tokens, collection_titles, scan_state) — в yuplink.
    options: '-c search_path=yuplink,public',
    max: 4,
    idleTimeoutMillis: 30000,
  });
  return global.__pgPool;
}

// libsql "?"-плейсхолдеры → Postgres "$1,$2,...".
function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export interface ExecuteResult {
  rows: Record<string, unknown>[];
  rowsAffected?: number;
}

class CompatClient {
  async execute(query: {
    sql: string;
    args?: (string | number | null)[];
  }): Promise<ExecuteResult> {
    const res = await pool().query(toPg(query.sql), (query.args ?? []) as unknown[]);
    return {
      rows: (res.rows ?? []) as Record<string, unknown>[],
      rowsAffected: res.rowCount ?? undefined,
    };
  }
  close(): void {
    /* pool живёт весь процесс */
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __turso: CompatClient | undefined;
}

export function turso(): CompatClient {
  if (global.__turso) return global.__turso;
  global.__turso = new CompatClient();
  return global.__turso;
}
