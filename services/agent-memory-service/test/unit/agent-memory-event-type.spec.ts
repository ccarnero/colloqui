import { describe, expect, it } from "bun:test";
import {
  AGENT_MEMORY_DOMAIN,
  AGENT_MEMORY_EXPIRED,
  AGENT_MEMORY_PROPOSED,
  AGENT_MEMORY_PUBLISHED,
  AGENT_MEMORY_REJECTED,
  PLATFORM_CHANNEL,
  PLATFORM_PROVIDER,
} from "@yoizen/shared";
import { buildEventTypeFromSubject } from "../../src/providers/agent-memory-event-type";

/**
 * envelope-drift post-loop item 1 — the `type` field obeys the grammar.
 *
 * `DOCS/messaging/envelope.md:77` prescribes
 * `io.yoizen.<domain>.<channel>.<provider>.<kind>.v1`. agent-memory emitted
 * `io.yoizen.agent-memory.memory.proposed.v1`: six dot-segments instead of
 * seven (counting `io.yoizen` as a two-segment prefix), no channel or provider
 * token, and a dotted kind (`memory.proposed`) that disagreed with the kind its
 * own subject carries (`memory_proposed`). Same class as the stage-1 token T05
 * fixed.
 *
 * The type is now DERIVED FROM THE SUBJECT CONSTANT, so the two cannot drift:
 * the subject template already holds domain/channel/provider/kind/version in
 * the order the type needs them. These tests check the derivation against the
 * independently-named shared constants, so a change to either side is caught.
 */

const CASES: ReadonlyArray<[string, string, string]> = [
  [
    "memory_proposed",
    AGENT_MEMORY_PROPOSED,
    "io.yoizen.agent-memory.platform.internal.memory_proposed.v1",
  ],
  [
    "memory_published",
    AGENT_MEMORY_PUBLISHED,
    "io.yoizen.agent-memory.platform.internal.memory_published.v1",
  ],
  [
    "memory_rejected",
    AGENT_MEMORY_REJECTED,
    "io.yoizen.agent-memory.platform.internal.memory_rejected.v1",
  ],
  [
    "memory_expired",
    AGENT_MEMORY_EXPIRED,
    "io.yoizen.agent-memory.platform.internal.memory_expired.v1",
  ],
];

describe("buildEventTypeFromSubject", () => {
  for (const [kind, subjectTemplate, expected] of CASES) {
    it(`${kind}: builds the prescriptive type`, () => {
      expect(buildEventTypeFromSubject(subjectTemplate)).toBe(expected);
    });

    it(`${kind}: composes exactly the shared tokens the subject uses`, () => {
      // The same string, assembled from the independently-named constants.
      expect(buildEventTypeFromSubject(subjectTemplate)).toBe(
        `io.yoizen.${AGENT_MEMORY_DOMAIN}.${PLATFORM_CHANNEL}.${PLATFORM_PROVIDER}.${kind}.v1`
      );
    });

    it(`${kind}: type kind token equals the subject kind token`, () => {
      const subjectKind = subjectTemplate.split(".").at(-2);
      const typeKind = buildEventTypeFromSubject(subjectTemplate)
        .split(".")
        .at(-2);

      expect(typeKind).toBe(subjectKind);
      expect(typeKind).toBe(kind);
      // The old dotted form split the kind across two segments.
      expect(typeKind).not.toContain(".");
      expect(String(typeKind).includes("_")).toBe(true);
    });
  }

  it("emits 7 dot-separated segments, matching envelope.md:77", () => {
    for (const [, subjectTemplate] of CASES) {
      const segments = buildEventTypeFromSubject(subjectTemplate).split(".");
      expect(segments.length).toBe(7);
      expect(segments.slice(0, 2)).toEqual(["io", "yoizen"]);
      expect(segments[2]).toBe(AGENT_MEMORY_DOMAIN);
      expect(segments[3]).toBe(PLATFORM_CHANNEL);
      expect(segments[4]).toBe(PLATFORM_PROVIDER);
      expect(segments[6]).toBe("v1");
    }
  });

  it("never emits the old channel-less, dotted-kind form", () => {
    for (const [, subjectTemplate] of CASES) {
      const type = buildEventTypeFromSubject(subjectTemplate);
      expect(type.startsWith("io.yoizen.agent-memory.memory.")).toBe(false);
      expect(type.split(".").length).not.toBe(6);
    }
  });

  it("is pure and independent of the tenant placeholder", () => {
    const template = AGENT_MEMORY_PROPOSED;
    const substituted = template.replaceAll("{tenant}", "acme");

    expect(buildEventTypeFromSubject(template)).toBe(
      buildEventTypeFromSubject(substituted)
    );
    expect(buildEventTypeFromSubject(template)).not.toContain("acme");
    expect(buildEventTypeFromSubject(template)).not.toContain("{tenant}");
  });

  it("rejects a subject that is not the canonical 8-token shape", () => {
    expect(() => buildEventTypeFromSubject("evt.acme.too.short")).toThrow();
  });
});
