import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { env } from "@/lib/env";

/**
 * One pool per process. Small, because Render restarts drop connections and
 * Neon's pooler is the thing that should be holding them, not us.
 */
declare global {
   
  var __sdrPool: Pool | undefined;
}

export function getPool(): Pool {
  if (!globalThis.__sdrPool) {
    const pool = new Pool({
      connectionString: env.databaseUrl,
      max: Number(process.env.PG_POOL_MAX ?? 8),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    // A pool-level error must never take the process down mid-run.
    pool.on("error", (err) => console.error("[pg] idle client error", err.message));
    globalThis.__sdrPool = pool;
  }
  return globalThis.__sdrPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await getPool().query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | undefined> {
  const rows = await query<T>(text, params);
  return rows[0];
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
