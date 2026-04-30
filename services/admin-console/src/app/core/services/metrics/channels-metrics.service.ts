import { Injectable, signal, type Signal } from "@angular/core";

/**
 * Channels section metrics.
 *
 * Phase 1 stub: signals return `null`. Phase 2 wires real fetches.
 */
@Injectable({ providedIn: "root" })
export class ChannelsMetricsService {
  // PHASE 2 DEMO SEEDS — replace with real fetches when backend lands.
  readonly connectedCount = signal<number | null>(3);
  readonly totalCount = signal<number | null>(4);
  readonly messagesIn24h = signal<number | null>(18_240);
  readonly messagesOut24h = signal<number | null>(15_982);
  readonly failedDeliveries24h = signal<number | null>(42);

  resolve(source: string): Signal<number | null> | null {
    switch (source) {
      case "channels.failed.24h":
        return this.failedDeliveries24h;
      case "channels.connected":
        return this.connectedCount;
      default:
        return null;
    }
  }
}
