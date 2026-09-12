/**
 * Every external call in this app goes through here. Non negotiable, because
 * one dead URL must never stop a run.
 */

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_RETRIES = 2;
export const DEFAULT_CONCURRENCY = 5;

export async function withTimeout<T>(
  label: string,
  ms: number,
  fn: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new TimeoutError(label, ms);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ResilientOptions = {
  label: string;
  timeoutMs?: number;
  retries?: number;
  /** Return false to fail fast without burning the remaining attempts. */
  retryOn?: (error: unknown) => boolean;
};

const RATE_LIMIT_RE = /rate limit|429|too many requests|quota/i;

export function isRateLimit(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return RATE_LIMIT_RE.test(message);
}

/**
 * Timeout, then up to `retries` more attempts with exponential backoff and jitter.
 *
 * A rate limit gets its own, much longer schedule. Exa and Firecrawl both meter
 * per minute, so retrying a 429 after 400ms just burns the attempt — the wait
 * has to be long enough for the window to actually roll over.
 */
export async function resilient<T>(
  opts: ResilientOptions,
  fn: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts.retries ?? DEFAULT_RETRIES;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await withTimeout(opts.label, timeoutMs, fn);
    } catch (error) {
      lastError = error;
      if (opts.retryOn && !opts.retryOn(error)) break;
      if (attempt === retries) break;
      const backoff = isRateLimit(error) ? Math.min(20_000, 8_000 * 2 ** attempt) : 400 * 2 ** attempt;
      await sleep(backoff + Math.random() * backoff * 0.3);
    }
  }
  throw lastError;
}

/** Minimal concurrency limiter. No dependency worth adding for 20 lines. */
export function pLimit(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  const next = () => {
    active -= 1;
    queue.shift()?.();
  };

  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        active += 1;
        fn().then(resolve, reject).finally(next);
      };
      if (active < concurrency) start();
      else queue.push(start);
    });
  };
}

/**
 * Runs `fn` over every item with a concurrency cap, never rejecting. Failures
 * come back as `{ ok: false }` so the caller decides what a dead item means.
 */
export async function mapWithLimit<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const limit = pLimit(concurrency);
  return Promise.all(
    items.map((item, index) =>
      limit(() => fn(item, index)).then(
        (value) => ({ ok: true as const, value }),
        (error) => ({ ok: false as const, error })
      )
    )
  );
}
