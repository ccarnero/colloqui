import { Injectable, signal, type Signal } from "@angular/core";

/**
 * Data section metrics (connectors, integrations, sources, schema, exports).
 *
 * Phase 1 stub: signals return `null`. Phase 2 wires real fetches.
 */
@Injectable({ providedIn: "root" })
export class DataMetricsService {
  // PHASE 2 DEMO SEEDS — replace with real fetches when backend lands.
  readonly connectorsConnected = signal<number | null>(7);
  readonly connectorsErrored = signal<number | null>(1);
  readonly connectorsSyncing = signal<number | null>(2);
  readonly recordsIngested24h = signal<number | null>(124_500);

  resolve(source: string): Signal<number | null> | null {
    switch (source) {
      case "data.connectors.errored":
        return this.connectorsErrored;
      case "data.connectors.syncing":
        return this.connectorsSyncing;
      default:
        return null;
    }
  }
}
