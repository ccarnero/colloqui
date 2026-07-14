/**
 * `POST /score` orchestration: parallel `Promise.all` fan-out of the two
 * SYNC `connectors.invoke()` calls (deals + tickets), then `computeScore()`
 * (SPEC T05).
 */

import type { ScorerConfig } from "./config.js";
import type { InvokeCapableClient } from "./hubspot-associations.js";
import { fetchAssociatedIds } from "./hubspot-associations.js";
import { log } from "./lib/logging.js";
import { computeScore, type ScoreResult } from "./score.js";

export async function scoreContact(
  client: InvokeCapableClient,
  config: ScorerConfig,
  contactId: string
): Promise<ScoreResult> {
  const [deals, tickets] = await Promise.all([
    fetchAssociatedIds(
      client,
      config.hubspotConnectorId,
      config.hubspotDealsEndpointId,
      contactId
    ),
    fetchAssociatedIds(
      client,
      config.hubspotConnectorId,
      config.hubspotTicketsEndpointId,
      contactId
    ),
  ]);

  if (!deals.ok) {
    log(`score: deals fetch degraded for contact=${contactId}: ${deals.error}`);
  }
  if (!tickets.ok) {
    log(
      `score: tickets fetch degraded for contact=${contactId}: ${tickets.error}`
    );
  }

  const result = computeScore({ deals, tickets });
  log(
    `score: contact=${contactId} score=${result.score} tier=${result.tier} reasons=${result.reasons.join(",")}`
  );
  return result;
}
