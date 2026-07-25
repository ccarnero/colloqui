/**
 * Pure priority-scoring rules for the crm-support-telegram demo. No I/O here
 * — `POST /score` (`src/server.ts`) fetches CRM data first, then calls
 * `computeScore()` with the result.
 *
 * DATA-AVAILABILITY GAP (recorded, not patched — see
 * manual-loops/demos/crm-support-telegram.md "Findings (T05)"): the `demo-hubspot`
 * connector's `list-deals-by-contact` / `list-tickets-by-contact` endpoints
 * (provisioned in T03) are HubSpot's v3 `associations/.../batch/read` routes,
 * which return ONLY associated object ids — no `amount` on deals, no status
 * on tickets. There is no connector endpoint that fetches deal/ticket
 * properties. `OPEN_DEAL_VALUE_VIP_THRESHOLD` is therefore evaluated against
 * the COUNT of associated deals (a proxy for "deal value"), and
 * `UNRESOLVED_TICKETS_ESCALATION_COUNT` against the COUNT of associated
 * tickets (a proxy for "unresolved") — the exact constant names the SPEC
 * requires, kept as top-level constants per the SPEC's "Human boundaries"
 * (changing thresholds needs sign-off).
 */

// Business rule: an account with this many OPEN deals is treated as VIP.
export const OPEN_DEAL_VALUE_VIP_THRESHOLD = 3;

// Business rule: an account with this many UNRESOLVED tickets is escalated.
export const UNRESOLVED_TICKETS_ESCALATION_COUNT = 3;

// Business rule: every scored contact starts from this neutral baseline.
export const BASE_SCORE = 40;

// Business rule: each open deal nudges the score up (revenue at risk).
export const SCORE_PER_OPEN_DEAL = 15;

// Business rule: each unresolved ticket nudges the score up (support burden).
export const SCORE_PER_OPEN_TICKET = 8;

// Business rule: the score is capped so a single noisy account can't blow
// past the readable 0-100 scale used in the demo narrative.
export const MAX_SCORE = 100;

// Business rule: when HubSpot is unreachable, the demo still replies with a
// safe neutral score instead of crashing the workflow.
export const DEGRADED_SCORE = BASE_SCORE;

export type PriorityTier = "vip" | "escalation" | "standard";

/** Outcome of fetching one association endpoint (deals or tickets). */
export interface AssociationFetchResult {
  ok: boolean;
  /** Associated object ids — empty when `ok` is false. */
  ids: string[];
  /** Present only when `ok` is false. */
  error?: string;
}

export interface ScoreInput {
  deals: AssociationFetchResult;
  tickets: AssociationFetchResult;
}

export interface ScoreResult {
  score: number;
  tier: PriorityTier;
  reasons: string[];
}

/**
 * Computes the priority score/tier/reasons for one contact from the two
 * HubSpot association fetches. Never throws — a failed fetch degrades the
 * score instead of propagating (SPEC T05 edge case: "HubSpot error ->
 * degraded score with reasons: ['crm-unavailable'], never a crash").
 */
export function computeScore(input: ScoreInput): ScoreResult {
  if (!input.deals.ok || !input.tickets.ok) {
    return {
      score: DEGRADED_SCORE,
      tier: "standard",
      reasons: ["crm-unavailable"],
    };
  }

  const dealsCount = input.deals.ids.length;
  const ticketsCount = input.tickets.ids.length;

  const rawScore =
    BASE_SCORE +
    dealsCount * SCORE_PER_OPEN_DEAL +
    ticketsCount * SCORE_PER_OPEN_TICKET;
  const score = Math.min(rawScore, MAX_SCORE);

  const reasons: string[] = [];
  let tier: PriorityTier = "standard";

  // Business rule: OPEN_DEAL_VALUE_VIP_THRESHOLD or more open deals marks a
  // VIP account.
  if (dealsCount >= OPEN_DEAL_VALUE_VIP_THRESHOLD) {
    tier = "vip";
    reasons.push(`open-deals-vip-threshold-met:${dealsCount}`);
  }

  // Business rule: UNRESOLVED_TICKETS_ESCALATION_COUNT or more unresolved
  // tickets triggers escalation — unless the contact is already VIP (VIP
  // wins the T06 workflow's `tier == "vip"` conditional branch).
  if (ticketsCount >= UNRESOLVED_TICKETS_ESCALATION_COUNT) {
    if (tier !== "vip") {
      tier = "escalation";
    }
    reasons.push(`unresolved-tickets-escalation-threshold-met:${ticketsCount}`);
  }

  if (reasons.length === 0) {
    reasons.push("no-threshold-triggered");
  }
  reasons.push(
    `open-deals:${dealsCount}`,
    `unresolved-tickets:${ticketsCount}`
  );

  return { score, tier, reasons };
}
