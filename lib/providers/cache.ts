import { query } from "@/lib/db/client";
import { sha256 } from "@/lib/crypto";
import { getStorage } from "@/lib/providers/storage";
import { features } from "@/lib/env";

/**
 * Scrape cache keyed by a content hash of the request. During a hackathon you
 * re-run the same profile generation twenty times, and this turns a 90 second
 * wait into 2 seconds.
 *
 * Payloads go to object storage under products/<id>/cache/<sha256>.json when
 * storage is configured, and to Postgres otherwise, so the cache works in dev
 * with no extra vendor.
 */

const MEMORY = new Map<string, { value: unknown; expires: number }>();
const MEMORY_TTL_MS = 10 * 60 * 1000;

export function cacheKey(parts: unknown[]): string {
  return sha256(JSON.stringify(parts));
}

function objectKey(productId: string, key: string): string {
  return `products/${productId}/cache/${key}.json`;
}

export async function cached<T>(
  productId: string | undefined,
  parts: unknown[],
  fn: () => Promise<T>
): Promise<T> {
  const key = cacheKey(parts);
  const now = Date.now();

  const hot = MEMORY.get(key);
  if (hot && hot.expires > now) return hot.value as T;

  const scope = productId ?? "_global";
  const stored = await readCache(scope, key);
  if (stored !== undefined) {
    MEMORY.set(key, { value: stored, expires: now + MEMORY_TTL_MS });
    return stored as T;
  }

  const value = await fn();
  MEMORY.set(key, { value, expires: now + MEMORY_TTL_MS });
  void writeCache(scope, key, value);
  return value;
}

async function readCache(scope: string, key: string): Promise<unknown | undefined> {
  try {
    if (features.storage) {
      const body = await getStorage().get(objectKey(scope, key));
      return body ? JSON.parse(body.toString("utf8")) : undefined;
    }
    const rows = await query<{ body: Buffer }>(
      `select body from storage_objects where object_key = $1`,
      [objectKey(scope, key)]
    );
    return rows[0] ? JSON.parse(rows[0].body.toString("utf8")) : undefined;
  } catch {
    return undefined;
  }
}

async function writeCache(scope: string, key: string, value: unknown): Promise<void> {
  try {
    const body = Buffer.from(JSON.stringify(value), "utf8");
    if (features.storage) {
      await getStorage().put(objectKey(scope, key), body, "application/json");
      return;
    }
    await query(
      `insert into storage_objects (object_key, bucket, mime_type, size_bytes, body)
       values ($1, $2, 'application/json', $3, $4)
       on conflict (object_key) do update set body = excluded.body, size_bytes = excluded.size_bytes`,
      [objectKey(scope, key), "local", body.byteLength, body]
    );
  } catch (error) {
    console.error("[cache] write failed", (error as Error).message);
  }
}
