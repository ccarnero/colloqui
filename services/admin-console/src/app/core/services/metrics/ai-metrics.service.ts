import { Injectable, inject, signal, type Signal } from "@angular/core";
import { AgentAdminService } from "../agent-admin.service";

/**
 * AI section metrics.
 *
 * The `*Total` signals back the sub-nav "created resources" badges and are
 * hydrated once via `loadCounts()`. The demo seeds below remain for the
 * section landing KPIs until those are wired to real data.
 *
 * Shape kept narrow on purpose — only metrics that surface in nav indicators
 * or section landing KPIs live here. Component-local metrics stay in
 * feature services.
 */
@Injectable({ providedIn: "root" })
export class AiMetricsService {
  private readonly admin = inject(AgentAdminService);
  private countsLoaded = false;

  /** Total agents created for the tenant. */
  readonly agentsTotal = signal<number | null>(null);
  /** Total memory proposals pending review. */
  readonly memoriesTotal = signal<number | null>(null);

  // PHASE 2 DEMO SEEDS — replace with real fetches when backend lands.
  readonly activeAgents = signal<number | null>(12);
  readonly tokensMtd = signal<number | null>(2_400_000);
  readonly costMtd = signal<number | null>(284);
  readonly pendingMemoryProposals = signal<number | null>(7);

  /**
   * Resolves a registry source key to one of this service's signals.
   * Returns null if the key isn't known to this section.
   */
  /**
   * Fetches real resource counts once. The agents request asks for a single
   * row but reads `total` from the response, so it stays cheap.
   */
  loadCounts(): void {
    if (this.countsLoaded) return;
    this.countsLoaded = true;
    this.admin.listAgents({ limit: 1, offset: 0 }).subscribe({
      next: (res) => this.agentsTotal.set(res.total),
      error: () => this.agentsTotal.set(null),
    });
    this.admin.listMemories({ status: "PROPOSED" }).subscribe({
      next: (res) => this.memoriesTotal.set(res.total),
      error: () => this.memoriesTotal.set(null),
    });
  }

  /** Forces a re-fetch of the counts (e.g. after a create/delete). */
  reload(): void {
    this.countsLoaded = false;
    this.loadCounts();
  }

  resolve(source: string): Signal<number | null> | null {
    switch (source) {
      case "ai.agents.total":
        return this.agentsTotal;
      case "ai.memories.total":
        return this.memoriesTotal;
      case "ai.memories.pending":
        return this.pendingMemoryProposals;
      case "ai.agents.active":
        return this.activeAgents;
      default:
        return null;
    }
  }
}
