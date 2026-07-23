import { describe, expect, it } from "vitest";
import { resolveBuilderDeepLink } from "../resolve-builder-deep-link";

describe("resolveBuilderDeepLink", () => {
  it("always returns null today — no trace-event/run-step -> builder-canvas-node id bridge exists (T01 finding 4)", () => {
    expect(resolveBuilderDeepLink()).toBeNull();
  });
});
