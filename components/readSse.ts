"use client";

/**
 * Reads an SSE body frame by frame.
 *
 * `EventSource` cannot POST, and both the profile and outreach routes are POSTs
 * that stream — so the frames get parsed by hand. That parsing was about to
 * exist in three places, which is two too many for something that silently
 * drops events when it is subtly wrong.
 *
 * `onEvent` is called once per frame, in order. Throwing from it aborts the
 * read, which is how an `error` frame turns into a rejected promise at the
 * call site.
 */
export async function readSse(
  response: Response,
  onEvent: (event: string, data: Record<string, unknown>) => void
): Promise<void> {
  if (!response.body) throw new Error("The server returned no stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // A frame ends at a blank line; whatever trails the last one is a partial
    // frame and stays in the buffer until the rest of it arrives.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const lines = frame.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event: "));
      const dataLine = lines.find((line) => line.startsWith("data: "));
      if (!eventLine || !dataLine) continue;

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(dataLine.slice(6)) as Record<string, unknown>;
      } catch {
        continue; // a frame we cannot read is not a reason to drop the rest
      }

      onEvent(eventLine.slice(7).trim(), data);
    }
  }
}
