import { Injectable, inject, type Signal, signal } from "@angular/core";
import { forkJoin } from "rxjs";
import { ChannelAdminService } from "../channel-admin.service";

/**
 * Channels section metrics.
 *
 * `telegramTotal` / `httpTotal` back the per-channel sub-nav "created
 * resources" badges and are hydrated once via `loadCounts()` (a single
 * accounts fetch split per channel). Usage traffic signals are hydrated
 * via `loadUsageTotals()`.
 */

function sumEvents(
  rows: { direction: string; events: number }[],
  direction: string
): number {
  return rows
    .filter((r) => r.direction === direction)
    .reduce((a, r) => a + r.events, 0);
}

@Injectable({ providedIn: "root" })
export class ChannelsMetricsService {
  private readonly channelsApi = inject(ChannelAdminService);

  /** Accounts created per channel. */
  readonly telegramTotal = signal<number | null>(null);
  readonly httpTotal = signal<number | null>(null);

  readonly connectedCount = signal<number | null>(null);
  readonly totalCount = signal<number | null>(null);
  readonly messagesIn24h = signal<number | null>(null);
  readonly messagesOut24h = signal<number | null>(null);
  readonly failedDeliveries24h = signal<number | null>(null);

  readonly telegramTraffic = signal<number | null>(null);
  readonly httpTraffic = signal<number | null>(null);

  /**
   * Fetches accounts once and folds them into per-channel counts in a
   * single O(n) pass.
   */
  loadCounts(): void {
    this.channelsApi.listAccounts().subscribe({
      next: (accounts) => {
        let telegram = 0;
        let http = 0;
        for (const account of accounts) {
          if (account.channel === "telegram") {
            telegram++;
          } else if (account.channel === "http") {
            http++;
          }
        }
        this.telegramTotal.set(telegram);
        this.httpTotal.set(http);
        this.connectedCount.set(accounts.length);
        this.totalCount.set(accounts.length);
      },
      error: () => {
        this.telegramTotal.set(null);
        this.httpTotal.set(null);
        this.connectedCount.set(null);
        this.totalCount.set(null);
      },
    });
  }

  /** Fetches 24h usage totals per channel. */
  loadUsageTotals(): void {
    const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const to = new Date().toISOString();
    forkJoin({
      all: this.channelsApi.getUsageTotals({ from, to }),
      telegram: this.channelsApi.getUsageTotals({
        from,
        to,
        channel: "telegram",
      }),
      http: this.channelsApi.getUsageTotals({ from, to, channel: "http" }),
    }).subscribe({
      next: ({ all, telegram, http }) => {
        this.messagesIn24h.set(sumEvents(all.items, "ingress"));
        this.messagesOut24h.set(sumEvents(all.items, "egress"));
        this.telegramTraffic.set(
          sumEvents(telegram.items, "ingress") +
            sumEvents(telegram.items, "egress")
        );
        this.httpTraffic.set(
          sumEvents(http.items, "ingress") + sumEvents(http.items, "egress")
        );
      },
      error: () => {
        // signals stay null — template shows —
      },
    });
  }

  /** Forces a re-fetch of the counts (e.g. after a create/delete). */
  reload(): void {
    this.loadCounts();
    this.loadUsageTotals();
  }

  resolve(source: string): Signal<number | null> | null {
    switch (source) {
      case "channels.telegram.total":
        return this.telegramTotal;
      case "channels.http.total":
        return this.httpTotal;
      case "channels.failed.24h":
        return this.failedDeliveries24h;
      case "channels.connected":
        return this.connectedCount;
      default:
        return null;
    }
  }
}
