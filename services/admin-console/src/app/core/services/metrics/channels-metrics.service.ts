import { Injectable, signal, type Signal } from "@angular/core";

/**
 * Channels section metrics.
 *
 * PHASE 4: dropped auto-reply tracking when the page was removed.
 * Demo seeds remain until backend aggregates land.
 */
@Injectable({ providedIn: "root" })
export class ChannelsMetricsService {
  readonly connectedCount = signal<number | null>(2);
  readonly totalCount = signal<number | null>(2);
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
