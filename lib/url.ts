/** Shared by server and client, so it must not live in a "use client" module. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * A `?from=` value is only ever used as an internal link, so anything that
 * could leave the app is discarded rather than sanitised.
 */
export function safeInternalPath(value: string | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/admin")) return null;
  if (value.startsWith("//")) return null;
  return value;
}
