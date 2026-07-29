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
  IRegisteredService,
  IServiceDetail,
} from "../../../core/models/registry.model";
import {
  ConnectorCallService,
  type IServiceCall,
} from "../../../core/services/connector-call.service";
import { RegistryService } from "../../../core/services/registry.service";
import { PageHeaderComponent } from "../../../shared/components/page-header/page-header.component";
import {
  type HealthStatus,
  StatusBadgeComponent,
} from "../../../shared/components/status-badge/status-badge.component";
import { UtcDatePipe } from "../../../shared/pipes/utc-date.pipe";
import {
  CallInspectorComponent,
  type ICallInspectorRow,
} from "../call-inspector/call-inspector.component";

/**
 * Hosted service detail page (T11 of
 * `manual-loops/connectors/connection-call-inspector.md`, SPEC decision 4 —
 * supersedes the old "hosted services list only" decision). Mirrors the
 * structure of `mcp-detail.component.ts` (Configuration / Recent calls),
 * per the design contract's Connection detail section
 * (`manual-loops/admin-console/design/Rediseño Terminal.dc.html:1191-1252`):
 * name (page header title), base URL + auth chip (Configuration section,
 * mock lines 1213-1221, auth masked-style per line 1218), Recent calls
 * (mock lines 1237-1250) opening the shared `app-call-inspector` (T07), plus
 * "View trace" secondary links.
 *
 * Deliberate deviations from the mock, both traceable to real data-model
 * gaps rather than invented values:
 * - **Base URL**: `IRegisteredService` carries no stored base-URL field —
 *   hosted services resolve their URL dynamically at call time
 *   (`service-call.activity.ts`'s `resolveServiceUrl`:
 *   `http://<knativeName>.<namespace>.svc.cluster.local`). This page
 *   computes the SAME real formula from the loaded service's
 *   `knativeName`/`namespace` rather than inventing a field; "—" when the
 *   service has no Knative deployment yet.
 * - **Auth chip**: `connections-fleet.component.ts`'s `mapHostedRow` already
 *   found (T01 of console-redesign-connections.md, finding 5) that hosted
 *   services have no per-service auth-type concept in the registry model —
 *   every service call is tenant-scoped only (`TENANT_HEADER`,
 *   `performRequest`/`resolveAndCallViaRegistry` in
 *   `service-call.activity.ts`, no per-service secret). This page shows that
 *   real, masked-by-construction fact as a static chip instead of inventing
 *   a per-service auth type.
 *
 * ID resolution: the route param can be either the registered service's
 * `id` (uuid — normal navigation, e.g. from `connections-fleet.component.ts`
 * row clicks) or its `name` (slug — deep links from
 * `resolve-entity-deep-link.ts`'s T11 mapping, since the tracked-events
 * `resource: service/<name>` carries only the name). The backend's
 * `GET /registry/services/:id` (`services.controller.ts`) is id-only, so a
 * failed direct lookup falls back to `RegistryService.listServices()` and a
 * client-side name match.
 */
@Component({
  selector: "app-hosted-service-detail",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatIconModule,
    MatProgressSpinnerModule,
    PageHeaderComponent,
    StatusBadgeComponent,
    UtcDatePipe,
    CallInspectorComponent,
  ],
  template: `
    <div class="ws-breadcrumb">
      <a [routerLink]="['/connections/hosted-services']" class="breadcrumb-link">
        <mat-icon>arrow_back</mat-icon>
        Hosted Services
      </a>
    </div>

    @if (loading()) {
      <div class="loader"><mat-spinner diameter="36"></mat-spinner></div>
    } @else if (errorMessage()) {
      <div class="error-banner">{{ errorMessage() }}</div>
    } @else if (server(); as s) {
      <app-page-header [title]="s.name" subtitle="Hosted service configuration">
        <ng-container slot="actions">
          <span class="identity-chips">
            <app-status-badge [status]="s.status" variant="dot" [health]="health()" />
          </span>
        </ng-container>
      </app-page-header>

      <section class="section">
        <h3 class="section-title">Configuration</h3>
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">Base URL</span>
            <span class="info-value mono">{{ baseUrl() ?? "—" }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Auth</span>
            <span class="info-value">
              <span class="auth-chip">{{ authChip() }}</span>
            </span>
          </div>
        </div>
      </section>

      <section class="section">
        <h3 class="section-title">Recent calls</h3>
        @if (callsLoading()) {
          <div class="loader">
            <mat-spinner diameter="24"></mat-spinner
            ><span>Loading recent calls…</span>
          </div>
        } @else if (recentCalls().length === 0) {
          <p class="no-calls">No calls in the last 7 days.</p>
        } @else {
          <div class="call-body">
            <div class="call-list">
              @for (c of recentCalls(); track $index) {
                <div
                  class="call-row"
                  role="button"
                  tabindex="0"
                  [class.call-row--selected]="selectedCall() === c"
                  (click)="openInspector(c)"
                  (keydown.enter)="openInspector(c)"
                >
                  <span class="call-ts">{{ c.timestamp | utcDate: "medium" }}</span>
                  <span class="call-method">{{ c.method }}</span>
                  <span class="call-status" [class]="statusClass(c.status)">{{ c.status }}</span>
                  <span class="call-dur">{{ c.durationMs }}ms</span>
                  <span class="call-url" [title]="c.resolvedUrl">{{ c.resolvedUrl }}</span>
                  @if (c.correlationId) {
                    <a
                      [routerLink]="['/processes/trace', c.correlationId]"
                      class="trace-link"
                      (click)="$event.stopPropagation()"
                    >
                      <mat-icon>open_in_new</mat-icon>
                      View trace
                    </a>
                  }
                </div>
              }
            </div>
            @if (inspectorRow(); as row) {
              <app-call-inspector [row]="row" (close)="closeInspector()" />
            }
          </div>
        }
      </section>
    }
  `,
  styles: `
    .ws-breadcrumb { margin-bottom: var(--rd-space-6, 12px); }
    .breadcrumb-link { display: inline-flex; align-items: center; gap: var(--rd-space-2, 4px); color: var(--rd-text-3); text-decoration: none; font-size: var(--rd-text-size-xs, 13px); }
    .breadcrumb-link:hover { color: var(--rd-text-1); }
    .loader { display: flex; justify-content: center; align-items: center; gap: var(--rd-space-4, 8px); padding: 2rem; }
    .error-banner { padding: var(--rd-space-6, 12px) var(--rd-space-8, 16px); border-radius: var(--rd-radius-5, 6px); background: var(--rd-red-dim); border: 1px solid var(--rd-red); color: var(--rd-red); font-size: var(--rd-text-size-xs, 13px); }
    .identity-chips { display: inline-flex; align-items: center; gap: var(--rd-space-5, 10px); }
    .section { margin-top: var(--rd-space-11, 24px); padding: var(--rd-space-8, 16px); border: 1px solid var(--rd-line); border-radius: var(--rd-radius-7, 8px); }
    .section-title { margin: 0 0 var(--rd-space-6, 12px); font-size: var(--rd-text-size-md, 14px); font-weight: 600; color: var(--rd-text-1); }
    .info-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--rd-space-6, 12px); }
    .info-item { display: flex; flex-direction: column; gap: 2px; }
    .info-label { font-size: var(--rd-text-size-xs, 11px); color: var(--rd-text-3); text-transform: uppercase; letter-spacing: 0.05em; }
    .info-value { font-size: var(--rd-text-size-base, 13px); color: var(--rd-text-1); }
    .mono { font-family: var(--rd-font-mono); }
    .auth-chip { font-family: var(--rd-font-mono); font-size: var(--rd-text-size-xs, 11px); border: 1px solid var(--rd-line-3); border-radius: var(--rd-radius-5, 6px); padding: 1px 7px; }
    .no-calls { color: var(--rd-text-3); font-size: var(--rd-text-size-base, 13px); margin: 0; }
    .call-body { display: flex; gap: var(--rd-space-8, 16px); align-items: flex-start; }
    .call-list { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: var(--rd-space-2, 4px); }
    .call-row { display: grid; grid-template-columns: 160px 70px 60px 70px 1fr auto; gap: var(--rd-space-4, 8px); align-items: center; padding: var(--rd-space-3, 6px) var(--rd-space-4, 8px); border-radius: var(--rd-radius-3, 4px); background: var(--rd-panel); font-size: var(--rd-text-size-sm, 12px); color: var(--rd-text-2); cursor: pointer; transition: background-color 0.12s; outline: none; }
    .call-row:hover, .call-row:focus-visible, .call-row--selected { background: var(--rd-hover); color: var(--rd-text-1); }
    .call-ts { color: var(--rd-text-3); font-size: var(--rd-text-size-xs, 11px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .call-method { font-family: var(--rd-font-mono); font-size: var(--rd-text-size-xs, 11px); font-weight: 600; color: var(--rd-link); }
    .call-status { font-family: var(--rd-font-mono); font-weight: 600; font-size: var(--rd-text-size-sm, 12px); }
    .st-2xx { color: var(--rd-green); }
    .st-4xx, .st-5xx { color: var(--rd-red); }
    .call-dur { color: var(--rd-text-3); font-size: var(--rd-text-size-xs, 11px); }
    .call-url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--rd-font-mono); font-size: var(--rd-text-size-xs, 11px); }
    .trace-link { display: inline-flex; align-items: center; gap: var(--rd-space-2, 4px); font-size: var(--rd-text-size-sm, 12px); color: var(--rd-accent); text-decoration: none; transition: color 0.12s; }
    .trace-link:hover { color: var(--rd-text-1); text-decoration: underline; }
    .trace-link mat-icon { font-size: 14px; width: 14px; height: 14px; }
  `,
})
export class HostedServiceDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly registryService = inject(RegistryService);
  private readonly calls = inject(ConnectorCallService);

  readonly server = signal<IServiceDetail | null>(null);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  readonly recentCalls = signal<IServiceCall[]>([]);
  readonly callsLoading = signal(false);

  /** Currently-selected "Recent calls" row — feeds the docked
   * `app-call-inspector` panel (T11, mirrors `mcp-detail.component.ts`'s
   * `selectedCall`). `null` means the inspector is closed. */
  readonly selectedCall = signal<IServiceCall | null>(null);

  /** Projects `selectedCall()` into the inspector's row contract, per
   * SPEC.md T07. Hosted service calls carry `endpoint_call_completed`
   * events (same kind as HTTP connectors — T01), so `kind` is hardcoded. */
  readonly inspectorRow = computed<ICallInspectorRow | null>(() => {
    const c = this.selectedCall();
    if (!c || !c.eventId || !c.correlationId) {
      return null;
    }
    return {
      eventId: c.eventId,
      correlationId: c.correlationId,
      kind: "endpoint_call_completed",
      scalars: {
        method: c.method,
        status: c.status,
        durationMs: c.durationMs,
        resolvedUrl: c.resolvedUrl,
        cacheResult: c.cacheResult,
      },
    };
  });

  /** Health mapping — reuses `connections-fleet.component.ts`'s
   * `mapHostedRow` semantics verbatim (decision 3 ruling 2026-07-22):
   * active -> ok, pending -> warn, error -> error, else idle. */
  readonly health = computed<HealthStatus>(() => {
    const status = this.server()?.status;
    if (status === "active") {
      return "ok";
    }
    if (status === "pending") {
      return "warn";
    }
    if (status === "error") {
      return "error";
    }
    return "idle";
  });

  /** Real, derived base URL — the SAME formula
   * `service-call.activity.ts`'s `resolveServiceUrl` uses at call time.
   * `null` (rendered as "—") when the service has no Knative deployment
   * yet (`knativeName`/`namespace` unset). */
  readonly baseUrl = computed<string | null>(() => {
    const s = this.server();
    if (!s?.knativeName || !s?.namespace) {
      return null;
    }
    return `http://${s.knativeName}.${s.namespace}.svc.cluster.local`;
  });

  /** Static masked-style chip — hosted services have no per-service
   * auth-type concept in the registry model (see class doc). */
  readonly authChip = computed<string>(() => "Internal (tenant-scoped)");

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const id = params.get("id") ?? "";
      this.load(id);
    });
  }

  protected statusClass(status: number): string {
    if (status >= 500) {
      return "st-5xx";
    }
    if (status >= 400) {
      return "st-4xx";
    }
    return "st-2xx";
  }

  /**
   * Resolves the route param to a service. Tries a direct id lookup first
   * (the common case — `connections-fleet.component.ts` row clicks pass
   * the registered service's `id`), then falls back to a name match via
   * `RegistryService.listServices()` for deep links that only carry the
   * `name` slug (`resolve-entity-deep-link.ts`'s T11 mapping).
   */
  private load(idOrName: string): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    console.debug("[HostedServiceDetailComponent] loading hosted service", {
      idOrName,
    });
    this.registryService.getService(idOrName).subscribe({
      next: (server) => this.onServiceLoaded(server),
      error: (err: unknown) => {
        console.debug(
          "[HostedServiceDetailComponent] direct id lookup failed, falling back to name resolution",
          { idOrName, err }
        );
        this.resolveByName(idOrName);
      },
    });
  }

  private resolveByName(name: string): void {
    this.registryService.listServices().subscribe({
      next: (services) => {
        const match = services.find((s: IRegisteredService) => s.name === name);
        if (!match) {
          console.error(
            "[HostedServiceDetailComponent] no service matches route param as id or name",
            { name }
          );
          this.errorMessage.set("Failed to load hosted service.");
          this.loading.set(false);
          return;
        }
        this.registryService.getService(match.id).subscribe({
          next: (server) => this.onServiceLoaded(server),
          error: (err: unknown) => {
            console.error(
              "[HostedServiceDetailComponent] name-resolved id lookup failed",
              { name, matchedId: match.id, err }
            );
            this.errorMessage.set("Failed to load hosted service.");
            this.loading.set(false);
          },
        });
      },
      error: (err: unknown) => {
        console.error(
          "[HostedServiceDetailComponent] failed to list services for name fallback",
          { name, err }
        );
        this.errorMessage.set("Failed to load hosted service.");
        this.loading.set(false);
      },
    });
  }

  private onServiceLoaded(server: IServiceDetail): void {
    this.server.set(server);
    this.loading.set(false);
    console.debug("[HostedServiceDetailComponent] hosted service loaded", {
      id: server.id,
      name: server.name,
      status: server.status,
    });
    this.loadCalls(server.name);
  }

  /** T11: "Recent calls" feed, `resource=service/<name>` (7-day default
   * window, limit 20 — mirrors `mcp-detail.component.ts`'s `loadCalls`). */
  private loadCalls(name: string): void {
    this.callsLoading.set(true);
    this.calls.recentServiceCalls(name, undefined, 20).subscribe({
      next: (rows) => {
        this.recentCalls.set(rows);
        this.callsLoading.set(false);
        console.debug("[HostedServiceDetailComponent] recent calls loaded", {
          name,
          count: rows.length,
        });
      },
      error: (err: unknown) => {
        console.error(
          "[HostedServiceDetailComponent] failed to load recent calls",
          { name, err }
        );
        this.callsLoading.set(false);
      },
    });
  }

  /** Opens the docked call inspector for the clicked row (T11). Rows
   * without an `eventId`/`correlationId` can't be resolved to a tracking
   * event, so the click is a no-op. */
  openInspector(call: IServiceCall): void {
    if (!call.eventId || !call.correlationId) {
      console.debug(
        "[HostedServiceDetailComponent] inspector open skipped — call row has no eventId/correlationId",
        { serviceName: call.serviceName, timestamp: call.timestamp }
      );
      return;
    }
    console.debug("[HostedServiceDetailComponent] opening call inspector", {
      eventId: call.eventId,
      correlationId: call.correlationId,
    });
    this.selectedCall.set(call);
  }

  /** Consumer side of the inspector's `close` output contract
   * (`call-inspector.component.ts`'s `onClose()`). */
  closeInspector(): void {
    console.debug("[HostedServiceDetailComponent] closing call inspector");
    this.selectedCall.set(null);
  }
}
