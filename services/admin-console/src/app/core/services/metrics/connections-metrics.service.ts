import { Injectable, computed, signal, type Signal } from "@angular/core";

/**
 * Connections section metrics — connectors grouped by type.
 *
 * Phase 4: HTTP collapses Internal + External into a single page.
 * Underlying counts stay separate so the UI can show a breakdown, but
 * the nav-level indicator looks at the combined totals.
 *
 * PHASE 4 DEMO SEEDS — replace with real fetches when backend lands.
 */
@Injectable({ providedIn: "root" })
export class ConnectionsMetricsService {
  readonly internalCount = signal<number | null>(4);
  readonly externalCount = signal<number | null>(12);
  readonly externalErrored = signal<number | null>(1);
  /** Internal-side error count — currently zero in the demo seed. */
  readonly internalErrored = signal<number | null>(0);
  readonly mcpCount = signal<number | null>(null);
  readonly hostedCount = signal<number | null>(7);

  /** Combined HTTP count (internal + external). */
  readonly httpCount = computed<number | null>(() => {
    const i = this.internalCount();
    const e = this.externalCount();
    if (i === null && e === null) return null;
    return (i ?? 0) + (e ?? 0);
  });

  /** Combined HTTP error count for the nav indicator. */
  readonly httpErrored = computed<number | null>(() => {
    const i = this.internalErrored();
    const e = this.externalErrored();
    if (i === null && e === null) return null;
    return (i ?? 0) + (e ?? 0);
  });

  resolve(source: string): Signal<number | null> | null {
    switch (source) {
      case "connections.http.count":
        return this.httpCount;
      case "connections.http.errored":
        return this.httpErrored;
      case "connections.internal.count":
        return this.internalCount;
      case "connections.external.count":
        return this.externalCount;
      case "connections.external.errored":
        return this.externalErrored;
      case "connections.hosted.count":
        return this.hostedCount;
      default:
        return null;
    }
  }
}
