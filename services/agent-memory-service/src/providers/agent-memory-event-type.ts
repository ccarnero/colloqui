/**
 * Builds the envelope `type` for an agent-memory lifecycle event FROM the
 * subject constant that the same event is published on.
 *
 * Format (`DOCS/messaging/envelope.md:77`):
 *   `io.yoizen.<domain>.<channel>.<provider>.<kind>.v1`
 *
 * The canonical 8-token subject already carries those tokens, in that order:
 *   `evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.v<n>`
 *      0     1         2         3        4         5        6      7
 * so the type is a projection of the subject. Deriving it here — instead of
 * hardcoding a parallel literal — is what makes the two impossible to drift:
 * there is one source of truth (the shared `AGENT_MEMORY_*` subject constants
 * in `packages/shared/src/constants.ts`), and no second place to forget.
 *
 * HISTORY (envelope-drift post-loop item 1): until 2026-07-31 this service
 * hardcoded `io.yoizen.agent-memory.memory.<verb>.v1` — six segments instead
 * of seven, no channel/provider tokens, and a dotted kind (`memory.proposed`)
 * that contradicted the kind on its own subject (`memory_proposed`). Same
 * class of defect as the stage-1 token fixed in T05. Events published before
 * that date carry the old value and stay queryable by it
 * (`GET /events?type=` filters `envelope->>'type'` verbatim,
 * `services/tracking-ingester-service/src/lib/build-events-query.ts:282`);
 * classification is unaffected either way because the tracking ingester
 * classifies by SUBJECT only (`classify.ts:160`).
 *
 * Pure and O(1). The tenant placeholder never appears in the output — the
 * type is tenant-independent by construction, since it projects tokens 3-7.
 */
export function buildEventTypeFromSubject(subjectTemplate: string): string {
  const tokens = subjectTemplate.split(".");
  if (tokens.length !== 8) {
    throw new Error(
      `Cannot build an event type from '${subjectTemplate}': expected the ` +
        `canonical 8-token subject shape, got ${tokens.length} tokens.`
    );
  }

  const [, , , domain, channel, provider, kind, version] = tokens;
  return `io.yoizen.${domain}.${channel}.${provider}.${kind}.${version}`;
}
