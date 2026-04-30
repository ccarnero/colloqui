import { describe, it, expect } from "bun:test";
import { matchAutoReplyPattern } from "../../src/modules/auto-reply/auto-reply.pattern";

describe("matchAutoReplyPattern", () => {
  it("matches wildcard", () => {
    expect(matchAutoReplyPattern("hello", "*")).toBe(true);
  });

  it("matches substring case-insensitively", () => {
    expect(matchAutoReplyPattern("Hello World", "world")).toBe(true);
    expect(matchAutoReplyPattern("Hi", "world")).toBe(false);
  });

  it("matches regex: prefix", () => {
    expect(matchAutoReplyPattern("abc123", "regex:^abc\\d+$")).toBe(true);
  });

  it("returns false on invalid regex", () => {
    expect(matchAutoReplyPattern("x", "regex:(")).toBe(false);
  });
});
