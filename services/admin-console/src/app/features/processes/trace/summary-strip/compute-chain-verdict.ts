import type { ITrackingChainResponse } from "../../../../core/services/tracking-chain.service";

/**
 * Chain-level delivery verdict for the shared summary strip (SPEC.md
 * `manual-loops/admin-console/console-redesign-polish.md` T07, T01 finding
 * 11's `VERDICT` cell).
 *
 * `null` covers every chain that never produced a `send`/`sent` event (most
 * workflow-triggered / `http-generic` chains — there is no message to
 * "deliver") — the strip shows no verdict rather than inventing one, the
 * same "hide rather than invent" rule the rest of this feature area already
 * follows (e.g. the always-hidden builder deep link, the hidden per-node
 * stats line).
 */
export type ChainVerdict = "replied" | "published-unconfirmed" | "received";

/**
 * REDUCED 3-state derivation (received / published-unconfirmed / replied).
 * The legacy pipeline's `deriveVerdict` (`domain/assemble-trace.ts`) also
 * distinguishes a `failed` delivery, but that branch reads the legacy
 * `ITraceNodeInput.delivery` field — `ITrackedEvent`
 * (`core/services/tracking-chain.service.ts`) carries NO delivery/outcome
 * signal, so the delivered-vs-failed distinction is unreachable from the
 * chain response this strip consumes. A failed send therefore renders as
 * `published-unconfirmed` here. DATA-GAP: a "failed" verdict needs a
 * delivery/outcome signal on the chain events (backend follow-up, see the
 * polish SPEC T07 findings).
 */
export function computeChainVerdict(
  chain: ITrackingChainResponse
): ChainVerdict | null {
  const kinds = new Set(chain.events.map((event) => event.kind));
  if (kinds.has("sent")) {
    return "replied";
  }
  if (kinds.has("send")) {
    return "published-unconfirmed";
  }
  if (kinds.has("received")) {
    return "received";
  }
  console.debug(
    "[computeChainVerdict] no send/sent/received event in chain — no verdict",
    { correlationId: chain.correlation_id, eventCount: chain.events.length }
  );
  return null;
}
