import { describe, expect, test } from "bun:test";
import {
  AGENT_MEMORY_DOMAIN,
  AGENT_MEMORY_EXPIRED,
  AGENT_MEMORY_PRODUCER,
  AGENT_MEMORY_PROPOSED,
  AGENT_MEMORY_PUBLISHED,
  AGENT_MEMORY_REJECTED,
  AGENT_MEMORY_SUBJECT_PREFIX,
  PLATFORM_CHANNEL,
  PLATFORM_PROVIDER,
} from "../index";

/**
 * agent-memory subject constants (envelope-drift T08, finding 6).
 *
 * These lived in `services/agent-memory-service/src/providers/nats.provider.ts`
 * — the only internal producer whose subject constants were NOT in
 * `packages/shared/src/constants.ts` next to their siblings
 * (`AGENT_ADMIN_SUBJECT_PREFIX` & co). Being service-local is what let the
 * subject's domain token (`agent-memory`) drift from the envelope's `domain`
 * field (`automation`, borrowed from the constant then named
 * `PLATFORM_DOMAIN`, today `AUTOMATION_DOMAIN`).
 *
 * Pinned here because TAXONOMY.md §4 rule 9 and SCHEMAS.md quote these
 * literals, and `tracking-ingester`'s classifier matches the subject tokens
 * exactly (`classify.ts:255-259`): a change here silently re-buckets every
 * agent-memory event as `unknown`.
 */
describe("agent-memory subject constants (shared)", () => {
  test("the subject prefix is the canonical 6-token stem", () => {
    expect(AGENT_MEMORY_SUBJECT_PREFIX).toBe(
      "evt.{tenant}.agent-memory-service.agent-memory.platform.internal"
    );
  });

  test("prefix tokens are built from the constants, so they cannot drift", () => {
    const tokens = AGENT_MEMORY_SUBJECT_PREFIX.split(".");
    expect(tokens[0]).toBe("evt");
    expect(tokens[1]).toBe("{tenant}");
    expect(tokens[2]).toBe(AGENT_MEMORY_PRODUCER);
    expect(tokens[3]).toBe(AGENT_MEMORY_DOMAIN);
    expect(tokens[4]).toBe(PLATFORM_CHANNEL);
    expect(tokens[5]).toBe(PLATFORM_PROVIDER);
  });

  test("producer and domain carry the values the classifier matches", () => {
    // tracking-ingester classify.ts rule 9 (TAXONOMY.md §4 rule 9).
    expect(AGENT_MEMORY_PRODUCER).toBe("agent-memory-service");
    expect(AGENT_MEMORY_DOMAIN).toBe("agent-memory");
    // NOT AUTOMATION_DOMAIN (then named PLATFORM_DOMAIN) — that mismatch was
    // the T08 finding.
    expect(AGENT_MEMORY_DOMAIN).not.toBe("automation");
  });

  test("the four lifecycle subjects keep their exact kinds", () => {
    expect(AGENT_MEMORY_PROPOSED).toBe(
      `${AGENT_MEMORY_SUBJECT_PREFIX}.memory_proposed.v1`
    );
    expect(AGENT_MEMORY_PUBLISHED).toBe(
      `${AGENT_MEMORY_SUBJECT_PREFIX}.memory_published.v1`
    );
    expect(AGENT_MEMORY_REJECTED).toBe(
      `${AGENT_MEMORY_SUBJECT_PREFIX}.memory_rejected.v1`
    );
    expect(AGENT_MEMORY_EXPIRED).toBe(
      `${AGENT_MEMORY_SUBJECT_PREFIX}.memory_expired.v1`
    );
  });

  test("every lifecycle subject is a canonical 8-token subject", () => {
    for (const subject of [
      AGENT_MEMORY_PROPOSED,
      AGENT_MEMORY_PUBLISHED,
      AGENT_MEMORY_REJECTED,
      AGENT_MEMORY_EXPIRED,
    ]) {
      expect(subject.split(".").length).toBe(8);
      expect(subject.endsWith(".v1")).toBe(true);
    }
  });
});
