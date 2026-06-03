import { Injectable, inject, signal, type Signal } from "@angular/core";
import { ChannelAdminService } from "../channel-admin.service";

/**
 * Channels section metrics.
 *
 * `whatsappTotal` / `telegramTotal` back the per-channel sub-nav "created
 * resources" badges and are hydrated once via `loadCounts()` (a single
 * accounts fetch split per channel). Demo seeds remain for landing KPIs.
 */
@Injectable({ providedIn: "root" })
export class ChannelsMetricsService {
  private readonly channelsApi = inject(ChannelAdminService);
  private countsLoaded = false;

  /** Accounts created per channel. */
  readonly whatsappTotal = signal<number | null>(null);
  readonly telegramTotal = signal<number | null>(null);

  readonly connectedCount = signal<number | null>(2);
  readonly totalCount = signal<number | null>(2);
  readonly messagesIn24h = signal<number | null>(18_240);
  readonly messagesOut24h = signal<number | null>(15_982);
  readonly failedDeliveries24h = signal<number | null>(42);

  /**
   * Fetches accounts once and folds them into per-channel counts in a
   * single O(n) pass.
   */
  loadCounts(): void {
    if (this.countsLoaded) return;
    this.countsLoaded = true;
    this.channelsApi.listAccounts().subscribe({
      next: (accounts) => {
        let whatsapp = 0;
        let telegram = 0;
        for (const account of accounts) {
          if (account.channel === "whatsapp") whatsapp++;
          else if (account.channel === "telegram") telegram++;
        }
        this.whatsappTotal.set(whatsapp);
        this.telegramTotal.set(telegram);
      },
      error: () => {
        this.whatsappTotal.set(null);
        this.telegramTotal.set(null);
      },
    });
  }

  /** Forces a re-fetch of the counts (e.g. after a create/delete). */
  reload(): void {
    this.countsLoaded = false;
    this.loadCounts();
  }

  resolve(source: string): Signal<number | null> | null {
    switch (source) {
      case "channels.whatsapp.total":
        return this.whatsappTotal;
      case "channels.telegram.total":
        return this.telegramTotal;
      case "channels.failed.24h":
        return this.failedDeliveries24h;
      case "channels.connected":
        return this.connectedCount;
      default:
        return null;
    }
  }
}
