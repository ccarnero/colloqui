import { Injectable, signal, type Signal } from "@angular/core";

/**
 * AI section metrics.
 *
 * Phase 1 stub: every signal returns `null` (= "no value yet, do not render").
 * Phase 2 wires real fetches against yoizenclaw-admin endpoints.
 *
 * Shape kept narrow on purpose — only metrics that surface in nav indicators
 * or section landing KPIs live here. Component-local metrics stay in
 * feature services.
 */
@Injectable({ providedIn: "root" })
export class AiMetricsService {
  // PHASE 2 DEMO SEEDS — replace with real fetches when backend lands.
  readonly activeAgents = signal<number | null>(12);
  readonly tokensMtd = signal<number | null>(2_400_000);
  readonly costMtd = signal<number | null>(284);
  readonly pendingMemoryProposals = signal<number | null>(7);

  /**
   * Resolves a registry source key to one of this service's signals.
   * Returns null if the key isn't known to this section.
   */
  resolve(source: string): Signal<number | null> | null {
    switch (source) {
      case "ai.memories.pending":
        return this.pendingMemoryProposals;
      case "ai.agents.active":
        return this.activeAgents;
      default:
        return null;
    }
  }
}
