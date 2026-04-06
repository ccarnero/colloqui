import { describe, it, expect } from "bun:test";
import { InstagramProvider } from "../../src/providers/meta/instagram/instagram.provider";

describe("InstagramProvider", () => {
  const provider = new InstagramProvider();

  it("parseWebhook returns empty when entry is missing", () => {
    expect(provider.parseWebhook({})).toEqual([]);
  });

  it("parseWebhook maps a text messaging event", () => {
    const raw = {
      entry: [
        {
          messaging: [
            {
              sender: { id: "user-1" },
              timestamp: 1_700_000_000_000,
              message: { mid: "m-1", text: "hello" },
            },
          ],
        },
      ],
    };
    const out = provider.parseWebhook(raw);
    expect(out.length).toBe(1);
    expect(out[0]?.messageId).toBe("m-1");
    expect(out[0]?.from).toBe("user-1");
    expect(out[0]?.text).toBe("hello");
    expect(out[0]?.type).toBe("text");
  });

  it("parseWebhook skips echo messages", () => {
    const raw = {
      entry: [
        {
          messaging: [
            {
              sender: { id: "user-1" },
              timestamp: 1,
              message: { mid: "m-e", is_echo: true, text: "echo" },
            },
          ],
        },
      ],
    };
    expect(provider.parseWebhook(raw)).toEqual([]);
  });
});
