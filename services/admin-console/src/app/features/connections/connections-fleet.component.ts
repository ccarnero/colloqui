import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  type OnInit,
  signal,
} from "@angular/core";
import { Router } from "@angular/router";
import type { IMcpServer } from "../../core/models/agent.model";
import type { IRegisteredService } from "../../core/models/registry.model";
import { AgentAdminService } from "../../core/services/agent-admin.service";
import type { IAdapterDto } from "../../core/services/http-adapter.service";
import { HttpAdapterService } from "../../core/services/http-adapter.service";
import { ConnectionsMetricsService } from "../../core/services/metrics/connections-metrics.service";
import { RegistryService } from "../../core/services/registry.service";
import {
  type InventoryTableColumn,
  InventoryTableComponent,
} from "../../shared/components/inventory-table/inventory-table.component";
import { KpiCardComponent } from "../../shared/components/kpi-card/kpi-card.component";
import type {
  AttentionSeverity,
  IAttentionIssue,
} from "../../shared/components/needs-attention-panel/needs-attention-panel.component";
import { NeedsAttentionPanelComponent } from "../../shared/components/needs-attention-panel/needs-attention-panel.component";
import type { HealthStatus } from "../../shared/components/status-badge/status-badge.component";

/** Connection kind, drives per-row routing (decision 2: routes unchanged). */
export type ConnectionKind = "http" | "mcp" | "hosted";

/** Chip filter value — "all" clears the kind filter entirely. */
export type ConnectionKindFilter = ConnectionKind | "all";

/**
 * Unified fleet row across the three real connection sources. Every field
 * here is a real, already-fetched value — no invented columns (T01 §6:
 * calls/p95/err/sparkline/usedBy are NO-DATA and are never mapped).
 */
interface IConnectionRow {
  id: string;
  kind: ConnectionKind;
  name: string;
  status: string;
  health: HealthStatus;
  /**
   * Real endpoint field (T01 finding 5, FIX T05 — mock's ENDPOINT column):
   * HTTP -> baseUrl, MCP -> url. Hosted services have no endpoint URL
   * concept, so this stays "—" for them (not invented).
   */
  endpoint: string;
  /**
   * Real auth field (T01 finding 5, FIX T05 — mock's AUTH column):
   * HTTP -> authType, MCP -> auth_type. Hosted services have no auth
   * concept, so this stays "—" for them (not invented).
   */
  auth: string;
}

const KIND_FILTERS: ReadonlyArray<{
  value: ConnectionKindFilter;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "http", label: "HTTP" },
  { value: "mcp", label: "MCP" },
  { value: "hosted", label: "Hosted" },
];

/**
 * Connections fleet body — KPI strip + filter chips + unified inventory
 * table + needs-attention panel. Extracted (T01 §5/§6, FIX T05) from
 * `ConnectionsLandingComponent` so `/connections` (all kinds) and
 * `/connections/mcp` (SIGNED decision 5b: pre-filtered to MCP, same data
 * sources, same URL) can both render the exact same fleet composition
 * instead of `/connections/mcp` keeping its own separate chrome
 * (T01 finding 6's "genuine chrome mismatch").
 *
 * The filter chips (All/HTTP/MCP/Hosted, per the mock) are TRIVIAL
 * client-side filtering over the rows already loaded here — not the
 * NEW-CAPABILITY "All channels" aggregate (that one needs a new backend
 * rollup; this one just re-filters an array already in memory).
 */
@Component({
  selector: "app-connections-fleet",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    KpiCardComponent,
    InventoryTableComponent,
    NeedsAttentionPanelComponent,
  ],
  template: `
    <!-- Fleet strip: only real counts (T02 — the design's calls/error-rate/
         p95/secrets-to-rotate KPIs are NO-DATA per T01 §6 and are not
         rendered). mcpSub is real (mcpServersEnabled); http/hosted have no
         real secondary metric today, so no sub text is shown for them. -->
    <div class="fleet-strip">
      <app-kpi-card label="HTTP" [value]="metrics.httpConnectorsTotal() ?? '—'" />
      <app-kpi-card
        label="MCP"
        [value]="metrics.mcpServersTotal() ?? '—'"
        [sub]="mcpSub()"
      />
      <app-kpi-card label="Hosted services" [value]="metrics.hostedTotal() ?? '—'" />
    </div>

    <!-- Filter chips (T01 §6, FIX T05): All/HTTP/MCP/Hosted, trivial
         client-side filter over the already-loaded unified rows array. -->
    <div class="chip-row" role="group" aria-label="Filter connections by kind">
      @for (chip of chips; track chip.value) {
        <button
          type="button"
          class="chip"
          [class.chip--active]="activeKind() === chip.value"
          (click)="onChipClick(chip.value)"
        >
          {{ chip.label }}
        </button>
      }
    </div>

    <!-- Inventory of every connection, filtered by the active chip. Health
         dot per the binding decision-3 ruling (2026-07-22): hosted ->
         statusColor() semantics, MCP -> enabled && is_active, HTTP ->
         status === "enabled". -->
    <app-inventory-table
      [columns]="columns"
      [rows]="filteredRows()"
      ariaLabel="Connections inventory"
      [emptyMessage]="emptyMessage()"
      (rowClick)="onRowClick($event)"
    />

    <!-- Needs attention: every filtered row whose health resolved to
         non-ok (T01 §6 — the design's error-rate/secret-expiry/unused-30d
         reasons are NO-DATA; this panel only surfaces the real
         enabled/disabled and hosted-status signals). -->
    <app-needs-attention-panel
      title="Needs attention"
      subtitle="connections"
      [issues]="attentionIssues()"
      emptyMessage="No connections need attention"
      (actionClick)="onAttentionActionClick($event)"
    />
  `,
  styles: `
    :host {
      display: block;
    }
    .fleet-strip {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: var(--rd-space-8, 16px);
      margin-bottom: var(--rd-space-8, 16px);
    }
    .chip-row {
      display: flex;
      gap: var(--rd-space-4, 8px);
      margin-bottom: var(--rd-space-8, 16px);
    }
    .chip {
      font-size: 12px;
      padding: 6px 14px;
      border: 1px solid var(--rd-line);
      border-radius: var(--rd-radius-full, 999px);
      background: var(--rd-panel);
      color: var(--rd-text-3);
      cursor: pointer;
    }
    .chip--active {
      background: var(--rd-accent);
      color: var(--rd-bg);
      border-color: var(--rd-accent);
    }
    app-inventory-table {
      display: block;
      margin-bottom: var(--rd-space-8, 16px);
    }
  `,
})
export class ConnectionsFleetComponent implements OnInit {
  protected readonly metrics = inject(ConnectionsMetricsService);
  private readonly router = inject(Router);
  private readonly httpAdapters = inject(HttpAdapterService);
  private readonly agentAdmin = inject(AgentAdminService);
  private readonly registry = inject(RegistryService);

  /**
   * Chip pre-selected on load. `/connections` passes "all" (unified
   * landing); `/connections/mcp` passes "mcp" (SIGNED decision 5b — same
   * table, pre-filtered, same URL/data sources). The chip row stays fully
   * interactive after load either way — this is not a route-locked filter.
   */
  readonly initialKind = input<ConnectionKindFilter>("all");

  protected readonly chips = KIND_FILTERS;
  protected readonly activeKind = signal<ConnectionKindFilter>("all");

  private readonly httpAdapterList = signal<IAdapterDto[]>([]);
  private readonly mcpServerList = signal<IMcpServer[]>([]);

  /**
   * T01 finding 5, FIX T05: mock columns are NOMBRE/ENDPOINT/AUTH/CALLS-24H
   * (Name/Endpoint/Auth · calls-24h stays DATA-GAP, same finding, no
   * call-aggregation field exists). Endpoint/Auth replace the prior
   * Type/Detail pair using the real `baseUrl`/`url` and `authType`/
   * `auth_type` fields already on `IAdapterDto`/`IMcpServer`.
   */
  protected readonly columns: InventoryTableColumn<IConnectionRow>[] = [
    {
      key: "name",
      header: "Name",
      type: "status-badge",
      variant: "dot",
      value: (r) => r.name,
      health: (r) => r.health,
    },
    {
      key: "endpoint",
      header: "Endpoint",
      type: "mono",
      value: (r) => r.endpoint,
    },
    {
      key: "auth",
      header: "Auth",
      type: "mono",
      value: (r) => r.auth,
      width: "120px",
    },
    {
      key: "status",
      header: "Status",
      type: "text",
      value: (r) => r.status,
      width: "110px",
    },
  ];

  protected readonly mcpSub = computed(() => {
    const total = this.metrics.mcpServersTotal();
    if (total === null) {
      return "backend unavailable";
    }
    const enabled = this.metrics.mcpServersEnabled() ?? 0;
    return `${enabled} enabled`;
  });

  /** Unified fleet rows across all three connection sources (unfiltered). */
  protected readonly rows = computed<IConnectionRow[]>(() => {
    const httpRows = this.httpAdapterList().map((a) => this.mapHttpRow(a));
    const mcpRows = this.mcpServerList().map((s) => this.mapMcpRow(s));
    const hostedRows = this.registry
      .services()
      .map((s) => this.mapHostedRow(s));
    const all = [...httpRows, ...mcpRows, ...hostedRows];
    console.debug("[ConnectionsFleetComponent] fleet rows computed", {
      http: httpRows.length,
      mcp: mcpRows.length,
      hosted: hostedRows.length,
      total: all.length,
    });
    return all;
  });

  /** Rows narrowed by the active chip — "all" is a no-op filter. */
  protected readonly filteredRows = computed<IConnectionRow[]>(() => {
    const kind = this.activeKind();
    const rows = this.rows();
    const filtered =
      kind === "all" ? rows : rows.filter((r) => r.kind === kind);
    console.debug("[ConnectionsFleetComponent] chip filter applied", {
      kind,
      total: rows.length,
      filtered: filtered.length,
    });
    return filtered;
  });

  protected readonly emptyMessage = computed(() => {
    const kind = this.activeKind();
    if (kind === "all") {
      return "No connections found. Create an HTTP connector, MCP server, or hosted service to get started.";
    }
    const label = this.chips.find((c) => c.value === kind)?.label ?? kind;
    return `No ${label} connections found.`;
  });

  protected readonly attentionIssues = computed<IAttentionIssue[]>(() => {
    const nonOk = this.filteredRows().filter((r) => r.health !== "ok");
    if (nonOk.length === 0) {
      // Verbose logging: empty attention list must not fail silently.
      console.debug(
        "[ConnectionsFleetComponent] no non-ok connections, needs-attention panel will render its empty state"
      );
    }
    return nonOk.map((r) => ({
      id: `${r.kind}:${r.id}`,
      message: `${r.name} (${r.kind}) is ${r.status}.`,
      severity: this.severityFor(r.health),
      action: { label: "View" },
    }));
  });

  ngOnInit(): void {
    this.activeKind.set(this.initialKind());
    console.debug("[ConnectionsFleetComponent] initial chip applied", {
      kind: this.initialKind(),
    });
    this.metrics.loadCounts();
    this.loadHttpAdapters();
    this.loadMcpServers();
    this.registry.loadServices();
  }

  protected onChipClick(kind: ConnectionKindFilter): void {
    console.debug("[ConnectionsFleetComponent] chip clicked", { kind });
    this.activeKind.set(kind);
  }

  /**
   * Public refresh hook for callers that mutate MCP servers from outside
   * this component (T05, SIGNED decision 5b: the "Add MCP server" CTA on
   * `/connections/mcp` reuses `McpServerDialogComponent`'s create wiring
   * directly, then calls this to keep the shared fleet table in sync
   * without a full page reload).
   */
  refreshMcpServers(): void {
    console.debug("[ConnectionsFleetComponent] external refresh requested");
    this.loadMcpServers();
  }

  private loadHttpAdapters(): void {
    this.httpAdapters.list().subscribe({
      next: (rows) => {
        this.httpAdapterList.set(rows);
        console.debug("[ConnectionsFleetComponent] HTTP adapters loaded", {
          count: rows.length,
        });
      },
      error: (err: unknown) => {
        this.httpAdapterList.set([]);
        console.error(
          "[ConnectionsFleetComponent] failed to load HTTP adapters",
          { error: err }
        );
      },
    });
  }

  private loadMcpServers(): void {
    this.agentAdmin.listMcpServers().subscribe({
      next: (rows) => {
        this.mcpServerList.set(rows);
        console.debug("[ConnectionsFleetComponent] MCP servers loaded", {
          count: rows.length,
        });
      },
      error: (err: unknown) => {
        this.mcpServerList.set([]);
        console.error(
          "[ConnectionsFleetComponent] failed to load MCP servers",
          { error: err }
        );
      },
    });
  }

  /**
   * HTTP connector health mapping — decision 3 ruling (2026-07-22):
   * status === "enabled" -> ok, else -> error. No warn is derivable (no
   * error-rate field on IAdapterDto, T01 §3).
   */
  private mapHttpRow(a: IAdapterDto): IConnectionRow {
    const health: HealthStatus = a.status === "enabled" ? "ok" : "error";
    console.debug("[ConnectionsFleetComponent] HTTP health derived", {
      id: a.id,
      status: a.status,
      health,
    });
    return {
      id: a.id,
      kind: "http",
      name: a.name,
      status: a.status,
      health,
      endpoint: a.baseUrl,
      auth: a.authType,
    };
  }

  /**
   * MCP server health mapping — decision 3 ruling (2026-07-22):
   * enabled && is_active -> ok, else -> error. No warn is derivable (no
   * call-success aggregation is wired here, T01 §3/§4).
   */
  private mapMcpRow(s: IMcpServer): IConnectionRow {
    const active = s.enabled && s.is_active;
    const health: HealthStatus = active ? "ok" : "error";
    console.debug("[ConnectionsFleetComponent] MCP health derived", {
      id: s.id,
      enabled: s.enabled,
      is_active: s.is_active,
      health,
    });
    return {
      id: s.id,
      kind: "mcp",
      name: s.name,
      status: active ? "active" : "inactive",
      health,
      endpoint: s.url,
      auth: s.auth_type,
    };
  }

  /**
   * Hosted service health mapping — decision 3 ruling (2026-07-22): reuse
   * the existing `statusColor()` semantics (active -> ok, pending -> warn,
   * error -> error). Any other raw status string falls back to "idle"
   * (unmapped/unknown — matches `statusColor()`'s "gray" fallback).
   */
  private mapHostedRow(s: IRegisteredService): IConnectionRow {
    let health: HealthStatus;
    if (s.status === "active") {
      health = "ok";
    } else if (s.status === "pending") {
      health = "warn";
    } else if (s.status === "error") {
      health = "error";
    } else {
      health = "idle";
    }
    console.debug("[ConnectionsFleetComponent] hosted health derived", {
      id: s.id,
      status: s.status,
      health,
    });
    return {
      id: s.id,
      kind: "hosted",
      name: s.name,
      status: s.status,
      health,
      // Hosted services have no endpoint URL / auth-type concept
      // (registered services model, T01 finding 5) — not invented.
      endpoint: "—",
      auth: "—",
    };
  }

  private severityFor(health: HealthStatus): AttentionSeverity {
    if (health === "error") {
      return "critical";
    }
    if (health === "warn") {
      return "warning";
    }
    return "warning";
  }

  /**
   * Row click navigates to the type's existing detail route (decision 2:
   * routes unchanged). Hosted services have no per-item detail route
   * (T01 §1) — clicking a hosted row goes to the existing hosted-services
   * list page instead of inventing a new route.
   */
  onRowClick(row: IConnectionRow): void {
    console.debug("[ConnectionsFleetComponent] fleet row clicked", {
      id: row.id,
      kind: row.kind,
    });
    this.navigateForKind(row.kind, row.id);
  }

  onAttentionActionClick(issue: IAttentionIssue): void {
    const [kind, id] = issue.id.split(":") as [ConnectionKind, string];
    console.debug(
      "[ConnectionsFleetComponent] needs-attention action clicked",
      { kind, id }
    );
    this.navigateForKind(kind, id);
  }

  private navigateForKind(kind: ConnectionKind, id: string): void {
    const path =
      kind === "http"
        ? ["/connections", "http", id]
        : kind === "mcp"
          ? ["/connections", "mcp", id]
          : ["/connections", "hosted-services"];
    this.router.navigate(path).catch((error: unknown) => {
      console.error("[ConnectionsFleetComponent] navigation failed", {
        kind,
        id,
        error,
      });
    });
  }
}
