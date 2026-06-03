import {
  Injectable,
  computed,
  inject,
  signal,
  type Signal,
} from "@angular/core";
import { HttpAdapterService } from "../http-adapter.service";
import { RegistryService } from "../registry.service";

/**
 * Connections section metrics — connectors grouped by type.
 *
 * Phase 4: HTTP collapses Internal + External into a single page.
 * Underlying counts stay separate so the UI can show a breakdown, but
 * the nav-level indicator looks at the combined totals.
 *
 * The `*Total` signals back the sub-nav "created resources" badges and are
 * hydrated once via `loadCounts()`. The legacy seeds below remain for the
 * section landing KPIs until those are wired to real data.
 */
@Injectable({ providedIn: "root" })
export class ConnectionsMetricsService {
  private readonly adapters = inject(HttpAdapterService);
  private readonly registry = inject(RegistryService);
  private countsLoaded = false;

  /** Total HTTP connectors created (internal + external). */
  readonly httpConnectorsTotal = signal<number | null>(null);

  /**
   * Total hosted services. Derived from the shared `RegistryService.services`
   * signal so the badge stays in sync with create/delete on the page.
   */
  readonly hostedTotal = computed<number | null>(() => {
    const n = this.registry.services().length;
    return n > 0 ? n : null;
  });

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

  /**
   * Fetches real resource counts once. Safe to call repeatedly; only the
   * first invocation triggers network requests.
   */
  loadCounts(): void {
    if (this.countsLoaded) return;
    this.countsLoaded = true;
    this.adapters.list().subscribe({
      next: (rows) => this.httpConnectorsTotal.set(rows.length),
      error: () => this.httpConnectorsTotal.set(null),
    });
    this.registry.loadServices();
  }

  /** Forces a re-fetch of the counts (e.g. after a create/delete). */
  reload(): void {
    this.countsLoaded = false;
    this.loadCounts();
  }

  resolve(source: string): Signal<number | null> | null {
    switch (source) {
      case "connections.http.total":
        return this.httpConnectorsTotal;
      case "connections.hosted.total":
        return this.hostedTotal;
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
