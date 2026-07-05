/**
 * Incremental Server-Sent Events (SSE) parser, protocol-only / JSON-agnostic
 * per DOCS/architecture/runtime-streaming.md §4.2's division of concerns: this
 * module only understands SSE framing (`event:`/`data:` lines, comments,
 * blank-line dispatch); JSON parsing and event-type mapping live in
 * `src/resources/runtime/client.ts`, one layer up.
 *
 * Implements the subset of the SSE spec
 * (https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream)
 * this SDK's producers actually use:
 *
 * - `event:` and `data:` fields; other fields (`id:`, `retry:`) are parsed
 *   but ignored — nothing in this platform's stream sets them today.
 * - Multi-line `data:` fields are joined with `\n`, per spec.
 * - A line starting with `:` is a comment and is silently dropped. The
 *   platform's relay (`pipe-upstream-sse-to-reply.util.ts`) sends `:hb\n\n`
 *   as a heartbeat every 15s specifically so long-idle connections aren't
 *   killed by intermediate proxies/load balancers — these must never
 *   surface as parsed frames.
 * - Both `\n` and `\r\n` line terminators are accepted (mixed, even within
 *   the same stream) by stripping a trailing `\r` off each line before
 *   testing it against the field grammar.
 * - An event is only dispatched on the blank line that terminates it. A
 *   frame is dispatched only if at least one `data:` line was seen — a bare
 *   `event:`-only block (never emitted by this platform) is intentionally
 *   swallowed rather than yielded with empty data, since nothing here reads
 *   event-only signals.
 * - Chunk-boundary correctness: `fetch`'s `ReadableStream<Uint8Array>` chunks
 *   the network delivers have no relationship to SSE line/event boundaries —
 *   a single line (even the terminating blank line) can be split across two
 *   `reader.read()` calls. Partial data is kept in a string buffer across
 *   reads; only complete lines (up to and including the next `\n`) are ever
 *   parsed out of it.
 * - If the stream ends mid-event (no trailing blank line), that dangling
 *   partial event is dropped, not yielded — per spec, dispatch only happens
 *   on the blank line.
 */

export interface SseFrame {
  /** Value of the `event:` field for this frame, if any (platform frames don't set it today). */
  event?: string;
  /** Joined value of all `data:` lines for this frame (`\n`-joined per spec). */
  data: string;
}

/**
 * Parses an SSE byte stream into frames. Consumes the stream's reader
 * directly (via `getReader()`) and releases the lock when done, including on
 * early `return()`/`throw()` from the consuming `for await` loop (e.g. the
 * caller stops iterating early on `failed` or abort) — `finally` covers all
 * three generator exit paths.
 */
export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<SseFrame, void, unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let eventName: string | undefined;
  let dataLines: string[] = [];

  function resetEvent(): void {
    eventName = undefined;
    dataLines = [];
  }

  function* drainCompleteLines(): Generator<SseFrame> {
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }

      if (line === "") {
        if (dataLines.length > 0) {
          yield { event: eventName, data: dataLines.join("\n") };
        }
        resetEvent();
        continue;
      }

      if (line.startsWith(":")) {
        // Comment / heartbeat line (e.g. ":hb") — ignored per spec.
        continue;
      }

      const colonIdx = line.indexOf(":");
      const field = colonIdx === -1 ? line : line.slice(0, colonIdx);
      let value = colonIdx === -1 ? "" : line.slice(colonIdx + 1);
      if (value.startsWith(" ")) {
        value = value.slice(1);
      }

      if (field === "event") {
        eventName = value;
      } else if (field === "data") {
        dataLines.push(value);
      }
      // `id:`/`retry:` and any other field: parsed off the buffer above
      // (so they don't leak into the next line) but otherwise ignored.
    }
  }

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      yield* drainCompleteLines();
    }
    // Flush any pending multi-byte sequence held by the decoder, then parse
    // whatever complete lines that produces. A dangling partial line/event
    // with no terminating blank line is intentionally dropped (see module doc).
    buffer += decoder.decode();
    yield* drainCompleteLines();
  } finally {
    reader.releaseLock();
  }
}
