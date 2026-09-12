"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False on the server and during hydration, true afterwards. Anything that
 * depends on the browser's locale or time zone has to wait for this: the server
 * formats with its own (in production, UTC and en-US), and the mismatch is a
 * hydration error.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/** A timestamp in the viewer's locale and time zone, drawn once hydrated. */
export function LocalTime({
  iso,
  options,
}: {
  iso: string;
  options?: Intl.DateTimeFormatOptions;
}) {
  const client = useIsClient();
  if (!client) return <>…</>;
  return <>{new Date(iso).toLocaleString(undefined, options)}</>;
}
