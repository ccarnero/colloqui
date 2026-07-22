import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { concatMap, from, of, switchMap, toArray } from "rxjs";
import { AuthService } from "../../../../core/services/auth.service";
import {
  ConnectorCallService,
  type IConnectorCall,
} from "../../../../core/services/connector-call.service";
import {
  HttpAdapterService,
  type IAdapterDto,
} from "../../../../core/services/http-adapter.service";
import { HttpAdapterDialogComponent } from "../../../../shared/components/http-adapter-dialog/http-adapter-dialog.component";
import { PageHeaderComponent } from "../../../../shared/components/page-header/page-header.component";
import {
  type HealthStatus,
  StatusBadgeComponent,
} from "../../../../shared/components/status-badge/status-badge.component";
import type {
  IHttpAdapterContext,
  IHttpAdapterDialogData,
  IHttpAdapterDialogResult,
} from "../../../../shared/models/http-adapter.model";
import { UtcDatePipe } from "../../../../shared/pipes/utc-date.pipe";
import { adapterDtoToHttpAdapter } from "./adapter-dto-to-http-adapter";
import { buildAdapterEndpointOperations } from "./build-adapter-endpoint-operations";
import { buildAdapterUpdatePayload } from "./build-adapter-update-payload";

const DIAGNOSTICS_PERMISSION = "diagnostics:read";

@Component({
  selector: "app-connector-detail",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    PageHeaderComponent,
    StatusBadgeComponent,
    UtcDatePipe,
  ],
  template: `
    <div class="ws-breadcrumb">
      <a [routerLink]="['/connections/http']" class="breadcrumb-link">
        <mat-icon>arrow_back</mat-icon>
        Connectors
      </a>
    </div>

    @if (loading()) {
      <div class="loader"><mat-spinner diameter="36"></mat-spinner></div>
    } @else if (errorMessage()) {
      <div class="error-banner">{{ errorMessage() }}</div>
    } @else if (adapter(); as a) {
      @if (saveError()) {
        <div class="error-banner save-error-banner">{{ saveError() }}</div>
      }
      <app-page-header [title]="a.name" subtitle="HTTP adapter configuration">
        <ng-container slot="actions">
          <span class="identity-chips">
            <app-status-badge
              [status]="a.status"
              variant="dot"
              [health]="health()"
            />
            <span class="id-chip" [class.id-chip--internal]="a.context === 'internal'">
              {{ a.context }}
            </span>
            @if (a.managedBy) {
              <span class="id-chip id-chip--synced" [title]="'Synced from ' + a.managedBy">
                <mat-icon class="id-chip-icon">sync</mat-icon>
                Synced
              </span>
            }
          </span>
          <button
            type="button"
            class="btn btn-outline btn-sm"
            (click)="openEdit()"
          >
            <mat-icon>edit</mat-icon>
            Edit
          </button>
        </ng-container>
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
            <span class="info-label">Base URL</span>
            <span class="info-value mono">{{ a.baseUrl }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Auth type</span>
            <span class="info-value">{{ a.authType }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Context</span>
            <span class="info-value">{{ a.context }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Status</span>
            <span class="info-value">{{ a.status }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Timeout</span>
            <span class="info-value">{{ a.timeoutMs }}ms</span>
          </div>
          <div class="info-item">
            <span class="info-label">Max retries</span>
            <span class="info-value">{{ a.maxRetries }}</span>
          </div>
          @if (a.managedBy) {
            <div class="info-item">
              <span class="info-label">Managed by</span>
              <span class="info-value">{{ a.managedBy }}</span>
            </div>
          }
        </div>
      </section>

      @if (a.endpoints.length > 0) {
        <section class="section">
          <h3 class="section-title">Endpoints</h3>
          <div class="endpoints-list">
            @for (ep of a.endpoints; track ep.id) {
              <div class="endpoint-card">
                <span class="endpoint-badge">{{ ep.method }}</span>
                <span class="endpoint-path">{{ ep.path }}</span>
                @if (ep.label) {
                  <span class="endpoint-label">{{ ep.label }}</span>
                }
                @if (ep.cache?.enabled) {
                  <span class="endpoint-cache">Cache: {{ ep.cache?.ttlSeconds }}s</span>
                }
              </div>
            }
          </div>
        </section>
      }

      @if (hasCacheConfig()) {
        <section class="section">
          <h3 class="section-title">Cache configuration</h3>
          <div class="info-grid">
            <div class="info-item">
              <span class="info-label">TTL (seconds)</span>
              <span class="info-value">{{ adapter()!.defaultCache?.ttlSeconds ?? "—" }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Methods</span>
              <span class="info-value">{{ adapter()!.defaultCache?.methods?.join(", ") ?? "—" }}</span>
            </div>
          </div>
        </section>
      }

      @if (canViewCalls()) {
        <section class="section">
          <h3 class="section-title">Recent calls</h3>
          @if (callsLoading()) {
            <div class="loader"><mat-spinner diameter="24"></mat-spinner><span>Loading recent calls…</span></div>
          } @else if (recentCalls().length === 0) {
            <p class="no-calls">No calls in the last 7 days.</p>
          } @else {
            <!-- T09: the audit-era REQUEST/RESPONSE (and cache-key/TTL)
                 expand sections were removed — since T04 the scalar row is
                 sourced from tracking.tracked_events, which never carries
                 payload bodies (payload viewing stays in the trace console,
                 by SPEC decision). Only the scalar row + View-trace link
                 remain as the payload path. -->
            <div class="call-list">
              @for (c of recentCalls(); track $index) {
                <div class="call-row">
                  <span class="call-ts">{{ c.timestamp | utcDate: "medium" }}</span>
                  <span class="call-method">{{ c.method }}</span>
                  <span class="call-status" [class]="statusClass(c.status)">{{ c.status }}</span>
                  <span class="call-dur">{{ c.durationMs }}ms</span>
                  <span class="call-url" [title]="c.resolvedUrl">{{ shortUrl(c.resolvedUrl) }}</span>
                  @if (c.cacheResult) {
                    <span
                      class="call-cache"
                      [class.cache-hit]="c.cacheResult === 'hit'"
                      [class.cache-miss]="c.cacheResult === 'miss'"
                      [class.cache-bypass]="c.cacheResult === 'bypass'"
                    >
                      {{ c.cacheResult }}
                    </span>
                  }
                  @if (c.correlationId) {
                    <a
                      [routerLink]="['/processes/trace', c.correlationId]"
                      class="trace-link"
                    >
                      <mat-icon>open_in_new</mat-icon>
                      View trace
                    </a>
                  }
                </div>
              }
            </div>
          }
        </section>
      }
    }
  `,
  styles: `
    .ws-breadcrumb {
      margin-bottom: var(--rd-space-6, 12px);
    }
    .breadcrumb-link {
      display: inline-flex;
      align-items: center;
      gap: var(--rd-space-2, 4px);
      color: var(--rd-text-3);
      text-decoration: none;
      font-size: var(--rd-text-size-xs, 13px);
    }
    .breadcrumb-link:hover {
      color: var(--rd-text-1);
    }
    .loader {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: var(--rd-space-4, 8px);
      padding: 2rem;
    }
    .error-banner {
      padding: var(--rd-space-6, 12px) var(--rd-space-8, 16px);
      border-radius: var(--rd-radius-5, 6px);
      background: var(--rd-red-dim);
      border: 1px solid var(--rd-red);
      color: var(--rd-red);
      font-size: var(--rd-text-size-xs, 13px);
    }
    .save-error-banner {
      margin-bottom: var(--rd-space-6, 12px);
    }
    .identity-chips {
      display: inline-flex;
      align-items: center;
      gap: var(--rd-space-5, 10px);
    }
    .id-chip {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-xs, 11px);
      color: var(--rd-text-2);
      border: 1px solid var(--rd-line-3);
      border-radius: var(--rd-radius-5, 6px);
      padding: 2px var(--rd-space-5, 9px);
      text-transform: capitalize;
    }
    .id-chip--internal {
      color: var(--rd-link);
    }
    .id-chip--synced {
      display: inline-flex;
      align-items: center;
      gap: var(--rd-space-2, 4px);
      color: var(--rd-text-3);
    }
    .id-chip-icon {
      font-size: 12px;
      width: 12px;
      height: 12px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: var(--rd-space-3, 6px);
      border-radius: var(--rd-radius-7, 8px);
      padding: 7px var(--rd-space-6, 12px);
      font-size: var(--rd-text-size-sm, 12.5px);
      font-weight: 500;
      cursor: pointer;
      font-family: inherit;
      border: 1px solid var(--rd-line-3);
      background: transparent;
      color: var(--rd-text-1);
    }
    .btn:hover {
      background: var(--rd-hover);
    }
    .btn mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }
    .section {
      margin-top: var(--rd-space-11, 24px);
      padding: var(--rd-space-8, 16px);
      border: 1px solid var(--rd-line);
      border-radius: var(--rd-radius-7, 8px);
    }
    .section-title {
      margin: 0 0 var(--rd-space-6, 12px);
      font-size: var(--rd-text-size-md, 14px);
      font-weight: 600;
      color: var(--rd-text-1);
    }
    .summary-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: var(--rd-space-6, 12px);
    }
    .summary-card {
      display: flex;
      flex-direction: column;
      gap: var(--rd-space-2, 4px);
      padding: var(--rd-space-6, 12px);
      background: var(--rd-panel);
      border: 1px solid var(--rd-line);
      border-radius: var(--rd-radius-5, 6px);
    }
    .summary-label {
      font-size: var(--rd-text-size-xs, 11px);
      color: var(--rd-text-3);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .summary-value {
      font-size: var(--rd-text-size-md, 14px);
      font-weight: 600;
      color: var(--rd-text-1);
      padding: var(--rd-space-2, 4px) var(--rd-space-4, 8px);
      border-radius: var(--rd-radius-3, 4px);
    }
    .badge-blue { color: var(--rd-accent); background: color-mix(in srgb, var(--rd-accent) 12%, transparent); }
    .badge-cyan { color: var(--rd-link); background: color-mix(in srgb, var(--rd-link) 12%, transparent); }
    .badge-orange { color: var(--rd-yellow); background: var(--rd-yellow-dim); }
    .badge-purple { color: var(--rd-purple); background: color-mix(in srgb, var(--rd-purple) 12%, transparent); }
    .badge-green { color: var(--rd-green); background: var(--rd-green-dim); }
    .badge-slate { color: var(--rd-text-3); background: var(--rd-hover); }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: var(--rd-space-6, 12px);
    }
    .info-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .info-label {
      font-size: var(--rd-text-size-xs, 11px);
      color: var(--rd-text-3);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .info-value {
      font-size: var(--rd-text-size-base, 13px);
      color: var(--rd-text-1);
    }
    .mono {
      font-family: var(--rd-font-mono);
    }
    .endpoints-list {
      display: flex;
      flex-direction: column;
      gap: var(--rd-space-4, 8px);
    }
    .endpoint-card {
      display: flex;
      align-items: center;
      gap: var(--rd-space-6, 12px);
      padding: var(--rd-space-6, 12px);
      background: var(--rd-panel);
      border-radius: var(--rd-radius-5, 6px);
      font-size: var(--rd-text-size-base, 13px);
      cursor: pointer;
      transition: background-color 0.12s;
    }
    .endpoint-card:hover {
      background: var(--rd-hover);
    }
    .endpoint-badge {
      font-size: var(--rd-text-size-xs, 11px);
      font-weight: 600;
      padding: 2px var(--rd-space-3, 6px);
      border-radius: var(--rd-radius-2, 3px);
      background: color-mix(in srgb, var(--rd-link) 15%, transparent);
      color: var(--rd-link);
      text-transform: uppercase;
      min-width: 50px;
      text-align: center;
    }
    .endpoint-path {
      flex: 1;
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-sm, 12px);
      color: var(--rd-text-2);
    }
    .endpoint-label {
      font-size: var(--rd-text-size-sm, 12px);
      color: var(--rd-text-3);
    }
    .endpoint-cache {
      font-size: var(--rd-text-size-xs, 11px);
      color: var(--rd-text-3);
      white-space: nowrap;
    }
    .no-calls {
      color: var(--rd-text-3);
      font-size: var(--rd-text-size-base, 13px);
      margin: 0;
    }
    .call-list {
      display: flex;
      flex-direction: column;
      gap: var(--rd-space-2, 4px);
    }
    .call-row {
      display: grid;
      grid-template-columns: 160px 60px 50px 70px 1fr auto;
      gap: var(--rd-space-4, 8px);
      align-items: center;
      padding: var(--rd-space-3, 6px) var(--rd-space-4, 8px);
      border-radius: var(--rd-radius-3, 4px);
      background: var(--rd-panel);
      font-size: var(--rd-text-size-sm, 12px);
      color: var(--rd-text-2);
      cursor: pointer;
      transition: background-color 0.12s;
      outline: none;
    }
    .call-row:hover,
    .call-row:focus-visible {
      background: var(--rd-hover);
      color: var(--rd-text-1);
    }
    .call-ts {
      color: var(--rd-text-3);
      font-size: var(--rd-text-size-xs, 11px);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .call-method {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-xs, 11px);
      font-weight: 600;
      color: var(--rd-link);
    }
    .call-status {
      font-family: var(--rd-font-mono);
      font-weight: 600;
      font-size: var(--rd-text-size-sm, 12px);
    }
    .st-2xx { color: var(--rd-green); }
    .st-3xx { color: var(--rd-yellow); }
    .st-4xx { color: var(--rd-yellow); }
    .st-5xx { color: var(--rd-red); }
    .call-dur {
      color: var(--rd-text-3);
      font-size: var(--rd-text-size-xs, 11px);
    }
    .call-url {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-xs, 11px);
    }
    .call-cache {
      font-size: var(--rd-text-size-3xs, 10px);
      padding: 1px 5px;
      border-radius: var(--rd-radius-2, 3px);
      font-weight: 600;
      text-transform: uppercase;
    }
    .cache-hit { background: var(--rd-green-dim); color: var(--rd-green); }
    .cache-miss { background: var(--rd-yellow-dim); color: var(--rd-yellow); }
    .cache-bypass { background: var(--rd-hover); color: var(--rd-text-3); }
    .trace-link {
      display: inline-flex;
      align-items: center;
      gap: var(--rd-space-2, 4px);
      font-size: var(--rd-text-size-sm, 12px);
      color: var(--rd-accent);
      text-decoration: none;
      transition: color 0.12s;
    }
    .trace-link:hover {
      color: var(--rd-text-1);
      text-decoration: underline;
    }
    .trace-link mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }
  `,
})
export class ConnectorDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly adapters = inject(HttpAdapterService);
  private readonly calls = inject(ConnectorCallService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);

  readonly adapter = signal<IAdapterDto | null>(null);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);
  readonly recentCalls = signal<IConnectorCall[]>([]);
  readonly callsLoading = signal(false);

  readonly canViewCalls = computed(() =>
    this.auth.hasPermission(DIAGNOSTICS_PERMISSION)
  );

  // Health mapping (SPEC console-redesign-connections.md, decision 3,
  // orchestrator ruling 2026-07-22): HTTP connectors map
  // status === "enabled" -> ok, else error. No warn is derivable — no
  // error-rate/threshold field exists (T01 §4).
  readonly health = computed<HealthStatus>(() =>
    this.adapter()?.status === "enabled" ? "ok" : "error"
  );

  readonly hasCacheConfig = computed(() => {
    const a = this.adapter();
    if (!a) {
      return false;
    }
    return (
      !!a.defaultCache?.enabled || a.endpoints.some((e) => !!e.cache?.enabled)
    );
  });

  readonly summaryCards = computed(() => {
    const a = this.adapter();
    if (!a) {
      return [];
    }
    return [
      {
        label: "Status",
        value: a.status,
        badgeClass: this.statusBadgeClass(a.status),
      },
      {
        label: "Auth",
        value: a.authType,
        badgeClass: "badge-blue",
      },
      {
        label: "Scope",
        value: a.context,
        badgeClass: this.contextBadgeClass(a.context),
      },
      {
        label: "Endpoints",
        value: String(a.endpoints.length),
        badgeClass: "badge-purple",
      },
      ...(this.canViewCalls()
        ? [
            {
              label: "Cache hits (7d)",
              value: String(
                this.recentCalls().filter((c) => c.cacheResult === "hit").length
              ),
              badgeClass: "badge-green",
            },
          ]
        : []),
    ];
  });

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const id = params.get("id") ?? "";
      this.load(id);
    });
  }

  private load(id: string): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    console.debug("[ConnectorDetailComponent] loading adapter", { id });
    this.adapters.get(id).subscribe({
      next: (dto) => {
        this.adapter.set(dto);
        this.loading.set(false);
        console.debug("[ConnectorDetailComponent] adapter loaded", {
          id,
          status: dto.status,
        });
        this.loadCalls(id);
      },
      error: (err: unknown) => {
        console.error("[ConnectorDetailComponent] failed to load adapter", {
          id,
          err,
        });
        this.errorMessage.set("Failed to load connector.");
        this.loading.set(false);
      },
    });
  }

  private loadCalls(id: string): void {
    if (!this.canViewCalls()) {
      console.debug(
        "[ConnectorDetailComponent] recent calls skipped — missing diagnostics:read permission",
        { id }
      );
      return;
    }
    this.callsLoading.set(true);
    this.calls.recentCalls(id, undefined, 20).subscribe({
      next: (rows) => {
        this.recentCalls.set(rows);
        this.callsLoading.set(false);
        console.debug("[ConnectorDetailComponent] recent calls loaded", {
          id,
          count: rows.length,
        });
      },
      error: (err: unknown) => {
        console.error(
          "[ConnectorDetailComponent] failed to load recent calls",
          {
            id,
            err,
          }
        );
        this.callsLoading.set(false);
      },
    });
  }

  /**
   * Edit action, reusing `HttpAdapterDialogComponent` exactly as
   * `connectors.component.ts` does — the form is never duplicated here,
   * only the update/endpoint-sync glue (mapping + payload builders live in
   * `adapter-dto-to-http-adapter.ts`, `build-adapter-update-payload.ts`,
   * `build-adapter-endpoint-operations.ts` in this folder).
   */
  openEdit(): void {
    const dto = this.adapter();
    if (!dto) {
      console.error(
        "[ConnectorDetailComponent] edit requested with no adapter loaded"
      );
      return;
    }
    const currentAdapter = adapterDtoToHttpAdapter(dto);
    const data: IHttpAdapterDialogData = {
      mode: "edit",
      context: dto.context as IHttpAdapterContext,
      adapter: currentAdapter,
    };
    console.debug("[ConnectorDetailComponent] opening adapter edit dialog", {
      id: dto.id,
    });
    this.dialog
      .open(HttpAdapterDialogComponent, {
        data,
        width: "860px",
        maxWidth: "95vw",
        panelClass: "app-dialog-panel",
      })
      .afterClosed()
      .subscribe((result?: IHttpAdapterDialogResult) => {
        if (!result) {
          console.debug("[ConnectorDetailComponent] edit dialog dismissed", {
            id: dto.id,
          });
          return;
        }
        const nextAdapter = {
          ...result.adapter,
          managedBy: dto.managedBy ?? null,
        };
        const endpointOps = buildAdapterEndpointOperations(
          dto.id,
          currentAdapter,
          nextAdapter,
          {
            addEndpoint: (adapterId, endpoint) =>
              this.adapters.addEndpoint(adapterId, endpoint),
            updateEndpoint: (adapterId, endpointId, payload) =>
              this.adapters.updateEndpoint(adapterId, endpointId, payload),
            removeEndpoint: (adapterId, endpointId) =>
              this.adapters.removeEndpoint(adapterId, endpointId),
          }
        );
        console.debug("[ConnectorDetailComponent] saving adapter edit", {
          id: dto.id,
          endpointOps: endpointOps.length,
        });
        this.saveError.set(null);
        // Fail-fast endpoint sync, mirroring connectors.component.ts:550-556
        // exactly: no endpoint ops short-circuits to `of([])`, otherwise every
        // op runs sequentially via concatMap and the whole chain errors (and
        // is surfaced to the user) the moment any single op fails — no silent
        // partial success.
        const endpointSync$ =
          endpointOps.length === 0
            ? of([])
            : from(endpointOps).pipe(
                concatMap((operation) => operation),
                toArray()
              );
        this.adapters
          .update(dto.id, buildAdapterUpdatePayload(nextAdapter))
          .pipe(
            switchMap(() => endpointSync$),
            switchMap(() => this.adapters.get(dto.id))
          )
          .subscribe({
            next: (updated) => {
              this.adapter.set(updated);
              console.debug("[ConnectorDetailComponent] adapter edit saved", {
                id: dto.id,
              });
              this.loadCalls(dto.id);
            },
            error: (err: unknown) => {
              console.error(
                "[ConnectorDetailComponent] failed to save adapter edit",
                {
                  id: dto.id,
                  err,
                }
              );
              this.saveError.set("Couldn't save changes. Please try again.");
            },
          });
      });
  }

  protected shortUrl(url: string): string {
    return url.length > 120 ? `${url.slice(0, 120)}…` : url;
  }

  protected statusClass(s: number): string {
    if (s >= 200 && s < 300) {
      return "st-2xx";
    }
    if (s >= 300 && s < 400) {
      return "st-3xx";
    }
    if (s >= 400 && s < 500) {
      return "st-4xx";
    }
    return "st-5xx";
  }

  private statusBadgeClass(status: string): string {
    const lower = status.toLowerCase();
    if (
      lower.includes("healthy") ||
      lower.includes("ok") ||
      lower.includes("active")
    ) {
      return "badge-green";
    }
    if (lower.includes("degraded") || lower.includes("warn")) {
      return "badge-orange";
    }
    return "badge-slate";
  }

  private contextBadgeClass(context: string): string {
    return context === "internal" ? "badge-cyan" : "badge-orange";
  }
}
