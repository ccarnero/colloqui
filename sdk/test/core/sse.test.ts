import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSseStream } from "../../src/core/sse.js";

/** Builds a `ReadableStream<Uint8Array>` that yields each string chunk verbatim (as UTF-8). */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i]!));
      i++;
    },
  });
}

async function collect(
  stream: ReadableStream<Uint8Array>
): Promise<Array<{ event?: string; data: string }>> {
  const frames: Array<{ event?: string; data: string }> = [];
  for await (const frame of parseSseStream(stream)) {
    frames.push(frame);
  }
  return frames;
}

test("parses a simple event: + data: frame terminated by a blank line (LF)", async () => {
  const frames = await collect(
    streamOf(['event: token\ndata: {"delta":"hi"}\n\n'])
  );
  assert.deepEqual(frames, [{ event: "token", data: '{"delta":"hi"}' }]);
});

test("parses multiple frames in one chunk", async () => {
  const frames = await collect(
    streamOf([
      'event: started\ndata: {"a":1}\n\n' +
        'event: token\ndata: {"delta":"a"}\n\n' +
        'event: completed\ndata: {"ok":true}\n\n',
    ])
  );
  assert.deepEqual(frames, [
    { event: "started", data: '{"a":1}' },
    { event: "token", data: '{"delta":"a"}' },
    { event: "completed", data: '{"ok":true}' },
  ]);
});

test("ignores comment/heartbeat lines (':hb') without producing spurious frames", async () => {
  const frames = await collect(
    streamOf([":hb\n\n", 'event: token\ndata: {"delta":"x"}\n\n', ":hb\n\n"])
  );
  assert.deepEqual(frames, [{ event: "token", data: '{"delta":"x"}' }]);
});

test("supports CRLF line terminators", async () => {
  const frames = await collect(
    streamOf(['event: token\r\ndata: {"delta":"crlf"}\r\n\r\n'])
  );
  assert.deepEqual(frames, [{ event: "token", data: '{"delta":"crlf"}' }]);
});

test("joins multi-line data: fields with \\n per spec", async () => {
  const frames = await collect(
    streamOf(["event: token\ndata: line1\ndata: line2\n\n"])
  );
  assert.deepEqual(frames, [{ event: "token", data: "line1\nline2" }]);
});

test("handles an event split across a chunk boundary mid-line", async () => {
  const frames = await collect(
    streamOf(['event: token\ndata: {"a":1', "}\n\n"])
  );
  assert.deepEqual(frames, [{ event: "token", data: '{"a":1}' }]);
});

test("handles the terminating blank line split across chunk boundaries", async () => {
  const frames = await collect(
    streamOf(['event: token\ndata: {"a":1}\n', "\n"])
  );
  assert.deepEqual(frames, [{ event: "token", data: '{"a":1}' }]);
});

test("drops a dangling partial event with no terminating blank line", async () => {
  const frames = await collect(
    streamOf(['event: token\ndata: {"a":1}\n\n', 'event: token\ndata: {"a":2}'])
  );
  assert.deepEqual(frames, [{ event: "token", data: '{"a":1}' }]);
});

test("does not dispatch an event with no data: lines", async () => {
  const frames = await collect(streamOf(["event: ping\n\n"]));
  assert.deepEqual(frames, []);
});
