import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
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
import { PageHeaderComponent } from "../../shared/components/page-header/page-header.component";
import type { HealthStatus } from "../../shared/components/status-badge/status-badge.component";

/** Connection kind, drives per-row routing (decision 2: routes unchanged). */
type ConnectionKind = "http" | "mcp" | "hosted";

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
  /** Per-type real field (T01 §3): HTTP -> authType, MCP -> transport_type, hosted -> image. */
  detail: string;
}

/**
 * Connections section landing — fleet operational view.
 *
 * Rebuilt per `manual-loops/admin-console/console-redesign-connections.md`
 * T02: fleet MetricCard row (real counts only, ConnectionsMetricsService),
 * an InventoryTable of every HTTP/MCP/hosted connection, and a
 * NeedsAttentionPanel for non-ok connections. The previous "most-used
 * connectors"/"recent activity" panels were dead code (T01 §2, §7 — hard-
 * coded to empty arrays) and have been removed along with their styles.
 */
@Component({
  selector: "app-connections-landing",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeaderComponent,
    KpiCardComponent,
    InventoryTableComponent,
    NeedsAttentionPanelComponent,
  ],
  template: `
    <app-page-header title="Connections" subtitle="Tenant integration catalog">
      <ng-container slot="actions">
        <button class="btn btn-primary btn-sm" type="button" (click)="newConnector()">
          + New connector
        </button>
      </ng-container>
    </app-page-header>

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

    <!-- Inventory of every connection, all three sources. Health dot per the
         binding decision-3 ruling (2026-07-22): hosted -> statusColor()
         semantics, MCP -> enabled && is_active, HTTP -> status === "enabled". -->
    <app-inventory-table
      [columns]="columns"
      [rows]="rows()"
      ariaLabel="Connections inventory"
      emptyMessage="No connections found. Create an HTTP connector, MCP server, or hosted service to get started."
      (rowClick)="onRowClick($event)"
    />

    <!-- Needs attention: every row whose health resolved to non-ok (T01 §6 —
         the design's error-rate/secret-expiry/unused-30d reasons are
         NO-DATA; this panel only surfaces the real enabled/disabled and
         hosted-status signals). -->
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
    app-inventory-table {
      display: block;
      margin-bottom: var(--rd-space-8, 16px);
    }
    .btn {
      font-size: 12px;
      padding: 6px 12px;
      border: 1px solid var(--rd-line);
      border-radius: var(--rd-radius-7, 8px);
      background: var(--rd-panel);
      color: var(--rd-text-1);
      cursor: pointer;
    }
    .btn-primary {
      background: var(--rd-accent);
      color: var(--rd-bg);
      border-color: var(--rd-accent);
    }
  `,
})
export class ConnectionsLandingComponent implements OnInit {
  protected readonly metrics = inject(ConnectionsMetricsService);
  private readonly router = inject(Router);
  private readonly httpAdapters = inject(HttpAdapterService);
  private readonly agentAdmin = inject(AgentAdminService);
  private readonly registry = inject(RegistryService);

  private readonly httpAdapterList = signal<IAdapterDto[]>([]);
  private readonly mcpServerList = signal<IMcpServer[]>([]);

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
      key: "kind",
      header: "Type",
      type: "mono",
      value: (r) => r.kind,
      width: "100px",
    },
    {
      key: "status",
      header: "Status",
      type: "text",
      value: (r) => r.status,
      width: "110px",
    },
    {
      key: "detail",
      header: "Detail",
      type: "mono",
      value: (r) => r.detail,
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

  /** Unified fleet rows across all three connection sources. */
  protected readonly rows = computed<IConnectionRow[]>(() => {
    const httpRows = this.httpAdapterList().map((a) => this.mapHttpRow(a));
    const mcpRows = this.mcpServerList().map((s) => this.mapMcpRow(s));
    const hostedRows = this.registry
      .services()
      .map((s) => this.mapHostedRow(s));
    const all = [...httpRows, ...mcpRows, ...hostedRows];
    console.debug("[ConnectionsLandingComponent] fleet rows computed", {
      http: httpRows.length,
      mcp: mcpRows.length,
      hosted: hostedRows.length,
      total: all.length,
    });
    return all;
  });

  protected readonly attentionIssues = computed<IAttentionIssue[]>(() => {
    const nonOk = this.rows().filter((r) => r.health !== "ok");
    if (nonOk.length === 0) {
      // Verbose logging: empty attention list must not fail silently.
      console.debug(
        "[ConnectionsLandingComponent] no non-ok connections, needs-attention panel will render its empty state"
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
    this.metrics.loadCounts();
    this.loadHttpAdapters();
    this.loadMcpServers();
    this.registry.loadServices();
  }

  private loadHttpAdapters(): void {
    this.httpAdapters.list().subscribe({
      next: (rows) => {
        this.httpAdapterList.set(rows);
        console.debug("[ConnectionsLandingComponent] HTTP adapters loaded", {
          count: rows.length,
        });
      },
      error: (err: unknown) => {
        this.httpAdapterList.set([]);
        console.error(
          "[ConnectionsLandingComponent] failed to load HTTP adapters",
          { error: err }
        );
      },
    });
  }

  private loadMcpServers(): void {
    this.agentAdmin.listMcpServers().subscribe({
      next: (rows) => {
        this.mcpServerList.set(rows);
        console.debug("[ConnectionsLandingComponent] MCP servers loaded", {
          count: rows.length,
        });
      },
      error: (err: unknown) => {
        this.mcpServerList.set([]);
        console.error(
          "[ConnectionsLandingComponent] failed to load MCP servers",
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
    console.debug("[ConnectionsLandingComponent] HTTP health derived", {
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
      detail: a.authType,
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
    console.debug("[ConnectionsLandingComponent] MCP health derived", {
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
      detail: s.transport_type,
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
    console.debug("[ConnectionsLandingComponent] hosted health derived", {
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
      detail: s.image,
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
    console.debug("[ConnectionsLandingComponent] fleet row clicked", {
      id: row.id,
      kind: row.kind,
    });
    this.navigateForKind(row.kind, row.id);
  }

  onAttentionActionClick(issue: IAttentionIssue): void {
    const [kind, id] = issue.id.split(":") as [ConnectionKind, string];
    console.debug(
      "[ConnectionsLandingComponent] needs-attention action clicked",
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
      console.error("[ConnectionsLandingComponent] navigation failed", {
        kind,
        id,
        error,
      });
    });
  }

  protected newConnector(): void {
    this.router.navigate(["/connections", "http"]).catch((error: unknown) => {
      console.error(
        "[ConnectionsLandingComponent] navigation to new-connector failed",
        { error }
      );
    });
  }
}
