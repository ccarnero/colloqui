import {
  computed,
  Injectable,
  inject,
  type Signal,
  signal,
} from "@angular/core";
import { AgentAdminService } from "../agent-admin.service";
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
  private readonly agentAdmin = inject(AgentAdminService);

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

  readonly internalCount = signal<number | null>(null);
  readonly externalCount = signal<number | null>(null);
  readonly externalErrored = signal<number | null>(null);
  /** Internal-side error count. */
  readonly internalErrored = signal<number | null>(null);
  readonly mcpCount = signal<number | null>(null);
  readonly hostedCount = signal<number | null>(null);

  /** Total MCP servers configured for the tenant. */
  readonly mcpServersTotal = signal<number | null>(null);
  /** Of those, how many are enabled + active. */
  readonly mcpServersEnabled = signal<number | null>(null);

  /** Combined HTTP count (internal + external). */
  readonly httpCount = computed<number | null>(() => {
    const i = this.internalCount();
    const e = this.externalCount();
    if (i === null && e === null) {
      return null;
    }
    return (i ?? 0) + (e ?? 0);
  });

  /** Combined HTTP error count for the nav indicator. */
  readonly httpErrored = computed<number | null>(() => {
    const i = this.internalErrored();
    const e = this.externalErrored();
    if (i === null && e === null) {
      return null;
    }
    return (i ?? 0) + (e ?? 0);
  });

  /**
   * Fetches real resource counts once. Safe to call repeatedly; only the
   * first invocation triggers network requests.
   */
  loadCounts(): void {
    this.adapters.list().subscribe({
      next: (rows) => {
        this.httpConnectorsTotal.set(rows.length);
        this.internalCount.set(rows.length);
        this.externalCount.set(0);
      },
      error: () => {
        this.httpConnectorsTotal.set(null);
        this.internalCount.set(null);
        this.externalCount.set(null);
      },
    });
    this.registry.loadServices();
    this.agentAdmin.listMcpServers().subscribe({
      next: (servers) => {
        this.mcpServersTotal.set(servers.length);
        this.mcpServersEnabled.set(
          servers.filter((s) => s.enabled && s.is_active).length
        );
      },
      error: () => {
        this.mcpServersTotal.set(null);
        this.mcpServersEnabled.set(null);
      },
    });
  }

  /** Forces a re-fetch of the counts (e.g. after a create/delete). */
  reload(): void {
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
      case "connections.mcp.total":
        return this.mcpServersTotal;
      case "connections.mcp.enabled":
        return this.mcpServersEnabled;
      default:
        return null;
    }
  }
}
