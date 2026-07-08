import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { ActivatedRoute, RouterLink } from "@angular/router";
import type {
  IMcpServer,
  IMcpServerTool,
  IMcpUsage,
  IMcpUsageRecentCall,
} from "../../../core/models/agent.model";
import { AgentAdminService } from "../../../core/services/agent-admin.service";
import { PageHeaderComponent } from "../../../shared/components/page-header/page-header.component";
import { UtcDatePipe } from "../../../shared/pipes/utc-date.pipe";

/**
 * MCP server detail page (mcp-connections.md §3, §6.3) — the MCP-side
 * analog of `connector-detail.component.ts`, mirroring its section
 * structure (Overview / Configuration / [Endpoints -> here: Tools] /
 * Recent calls). Two deliberate differences from the connector page:
 *
 * - **Tools** is read-only, with no "+ Add Tool" affordance anywhere — MCP
 *   tools are discovered live from the server (`GET :id/tools`), never
 *   manually defined (mcp-connections.md §6.4's explicit clarification).
 * - **Recent calls** comes from one combined endpoint
 *   (`GET :id/usage`, mcp-connections.md §3) that returns both the
 *   aggregate summary (for the Overview cards) and the recent-call list,
 *   rather than a separate audit-events endpoint the way Connectors' recent
 *   calls does — see `mcp-servers.service.ts`'s `getUsage` for why.
 */
@Component({
  selector: "app-mcp-detail",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatIconModule,
    MatProgressSpinnerModule,
    PageHeaderComponent,
    UtcDatePipe,
  ],
  template: `
    <div class="ws-breadcrumb">
      <a [routerLink]="['/connections/mcp']" class="breadcrumb-link">
        <mat-icon>arrow_back</mat-icon>
        MCP Servers
      </a>
    </div>

    @if (loading()) {
      <div class="loader"><mat-spinner diameter="36"></mat-spinner></div>
    } @else if (errorMessage()) {
      <div class="error-banner">{{ errorMessage() }}</div>
    } @else if (server(); as s) {
      <app-page-header [title]="s.name" subtitle="MCP server configuration">
      </app-page-header>

      <section class="section">
        <h3 class="section-title">Overview</h3>
        <div class="summary-cards">
          @for (card of summaryCards(); track card.label) {
            <div class="summary-card">
              <div class="summary-label">{{ card.label }}</div>
              <div class="summary-value" [class]="card.badgeClass">
                {{ card.value }}
              </div>
            </div>
          }
        </div>
      </section>

      <section class="section">
        <h3 class="section-title">Configuration</h3>
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">URL</span>
            <span class="info-value mono">{{ s.url }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Transport</span>
            <span class="info-value">{{ s.transport_type }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Auth type</span>
            <span class="info-value">{{ s.auth_type }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Status</span>
            <span class="info-value">
              {{ s.enabled && s.is_active ? "Enabled" : "Disabled" }}
            </span>
          </div>
          @if (s.managed_by) {
            <div class="info-item">
              <span class="info-label">Managed by</span>
              <span class="info-value">{{ s.managed_by }}</span>
            </div>
          }
        </div>
      </section>

      <section class="section">
        <h3 class="section-title">Tools</h3>
        @if (toolsLoading()) {
          <div class="loader"><mat-spinner diameter="24"></mat-spinner></div>
        } @else if (toolsError()) {
          <p class="no-calls">Couldn't load tools from this server.</p>
        } @else if (tools().length === 0) {
          <p class="no-calls">This server exposes no tools right now.</p>
        } @else {
          <div class="endpoints-list">
            @for (t of tools(); track t.name) {
              <div class="endpoint-card">
                <span class="endpoint-path">{{ t.name }}</span>
                @if (t.description) {
                  <span class="endpoint-label">{{ t.description }}</span>
                }
                <span class="endpoint-cache">{{ schemaSummary(t) }}</span>
              </div>
            }
          </div>
        }
      </section>

      <section class="section">
        <h3 class="section-title">Recent calls</h3>
        @if (usageLoading()) {
          <div class="loader">
            <mat-spinner diameter="24"></mat-spinner
            ><span>Loading recent calls…</span>
          </div>
        } @else if (recentCalls().length === 0) {
          <p class="no-calls">No calls in the selected window.</p>
        } @else {
          <div class="call-list">
            @for (c of recentCalls(); track $index; let idx = $index) {
              <div class="call-row">
                <span class="call-ts">{{ c.createdAt | utcDate: "medium" }}</span>
                <span class="call-method">{{ c.toolName }}</span>
                <span class="call-status" [class]="c.success ? 'st-2xx' : 'st-5xx'">
                  {{ c.success ? "OK" : "Error" }}
                </span>
                <span class="call-dur">{{ c.durationMs }}ms</span>
                <span class="call-url">{{ c.error ?? "" }}</span>
              </div>
            }
          </div>
        }
      </section>
    }
  `,
  styles: `
    .ws-breadcrumb { margin-bottom: 12px; }
    .breadcrumb-link { display: inline-flex; align-items: center; gap: 4px; color: var(--text3, #94a3b8); text-decoration: none; font-size: 13px; }
    .breadcrumb-link:hover { color: var(--text, #e5e7eb); }
    .loader { display: flex; justify-content: center; align-items: center; gap: 8px; padding: 2rem; }
    .error-banner { padding: 12px 16px; border-radius: 6px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #ef4444; font-size: 13px; }
    .section { margin-top: 24px; padding: 16px; border: 1px solid var(--border, rgba(255,255,255,0.08)); border-radius: 8px; }
    .section-title { margin: 0 0 12px; font-size: 14px; font-weight: 600; color: var(--text, #e5e7eb); }
    .summary-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .summary-card { display: flex; flex-direction: column; gap: 4px; padding: 12px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border); border-radius: 6px; }
    .summary-label { font-size: 11px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.05em; }
    .summary-value { font-size: 14px; font-weight: 600; color: var(--text); padding: 4px 8px; border-radius: 4px; }
    .badge-blue { color: #3b82f6; background: rgba(59, 130, 246, 0.1); }
    .badge-cyan { color: #22d3ee; background: rgba(34, 211, 238, 0.1); }
    .badge-orange { color: #f97316; background: rgba(249, 115, 22, 0.1); }
    .badge-purple { color: #a855f7; background: rgba(168, 85, 247, 0.1); }
    .badge-green { color: #4ade80; background: rgba(74, 222, 128, 0.1); }
    .badge-slate { color: #94a3b8; background: rgba(148, 163, 184, 0.1); }
    .info-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
    .info-item { display: flex; flex-direction: column; gap: 2px; }
    .info-label { font-size: 11px; color: var(--text3, #94a3b8); text-transform: uppercase; letter-spacing: 0.05em; }
    .info-value { font-size: 13px; color: var(--text, #e5e7eb); }
    .mono { font-family: monospace; }
    .endpoints-list { display: flex; flex-direction: column; gap: 8px; }
    .endpoint-card { display: flex; align-items: center; gap: 12px; padding: 12px; background: rgba(255, 255, 255, 0.03); border-radius: 6px; font-size: 13px; }
    .endpoint-path { font-family: monospace; font-size: 12px; color: var(--text2); }
    .endpoint-label { flex: 1; font-size: 12px; color: var(--text3); }
    .endpoint-cache { font-size: 11px; color: var(--text3); white-space: nowrap; }
    .no-calls { color: var(--text3, #94a3b8); font-size: 13px; margin: 0; }
    .call-list { display: flex; flex-direction: column; gap: 4px; }
    .call-row { display: grid; grid-template-columns: 160px 1fr 60px 70px 1fr; gap: 8px; align-items: center; padding: 6px 8px; border-radius: 4px; background: rgba(255,255,255,0.03); font-size: 12px; color: var(--text2, #cbd5e1); }
    .call-ts { color: var(--text3, #94a3b8); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .call-method { font-family: monospace; font-size: 11px; font-weight: 600; color: var(--cyan, #22d3ee); }
    .call-status { font-family: monospace; font-weight: 600; font-size: 12px; }
    .st-2xx { color: #4ade80; }
    .st-5xx { color: #f87171; }
    .call-dur { color: var(--text3, #94a3b8); font-size: 11px; }
    .call-url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; font-size: 11px; }
  `,
})
export class McpDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly agentAdminService = inject(AgentAdminService);

  readonly server = signal<IMcpServer | null>(null);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  readonly tools = signal<IMcpServerTool[]>([]);
  readonly toolsLoading = signal(false);
  readonly toolsError = signal(false);

  readonly usage = signal<IMcpUsage | null>(null);
  readonly usageLoading = signal(false);

  readonly recentCalls = computed<IMcpUsageRecentCall[]>(
    () => this.usage()?.recentCalls ?? []
  );

  readonly summaryCards = computed(() => {
    const s = this.server();
    if (!s) {
      return [];
    }
    const usage = this.usage();
    return [
      {
        label: "Status",
        value: s.enabled && s.is_active ? "Enabled" : "Disabled",
        badgeClass: s.enabled && s.is_active ? "badge-green" : "badge-slate",
      },
      {
        label: "Auth",
        value: s.auth_type,
        badgeClass: "badge-blue",
      },
      {
        label: "Transport",
        value: s.transport_type,
        badgeClass: "badge-orange",
      },
      {
        label: "Tools",
        value: this.toolsLoading() ? "…" : String(this.tools().length),
        badgeClass: "badge-purple",
      },
      {
        label: `Calls (${usage?.windowDays ?? 7}d)`,
        value: this.usageLoading()
          ? "…"
          : String(usage?.summary.totalCalls ?? 0),
        badgeClass: "badge-green",
      },
    ];
  });

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const id = params.get("id") ?? "";
      this.load(id);
    });
  }

  protected schemaSummary(tool: IMcpServerTool): string {
    const schema = tool.inputSchema as
      | { properties?: Record<string, unknown>; required?: string[] }
      | null
      | undefined;
    const propertyNames = schema?.properties
      ? Object.keys(schema.properties)
      : [];
    if (propertyNames.length === 0) {
      return "No parameters";
    }
    const required = new Set(schema?.required ?? []);
    return propertyNames
      .map((name) => (required.has(name) ? `${name}*` : name))
      .join(", ");
  }

  private load(id: string): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.agentAdminService.getMcpServer(id).subscribe({
      next: (server) => {
        this.server.set(server);
        this.loading.set(false);
        this.loadTools(id);
        this.loadUsage(id);
      },
      error: () => {
        this.errorMessage.set("Failed to load MCP server.");
        this.loading.set(false);
      },
    });
  }

  private loadTools(id: string): void {
    this.toolsLoading.set(true);
    this.toolsError.set(false);
    this.agentAdminService.listMcpServerTools(id).subscribe({
      next: (tools) => {
        this.tools.set(tools);
        this.toolsLoading.set(false);
      },
      error: () => {
        this.toolsError.set(true);
        this.toolsLoading.set(false);
      },
    });
  }

  private loadUsage(id: string): void {
    this.usageLoading.set(true);
    this.agentAdminService.getMcpServerUsage(id).subscribe({
      next: (usage) => {
        this.usage.set(usage);
        this.usageLoading.set(false);
      },
      error: () => {
        this.usageLoading.set(false);
      },
    });
  }
}
