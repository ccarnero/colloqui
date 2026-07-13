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
import { AuthService } from "../../../../core/services/auth.service";
import {
  ConnectorCallService,
  type IConnectorCall,
} from "../../../../core/services/connector-call.service";
import {
  HttpAdapterService,
  type IAdapterDto,
} from "../../../../core/services/http-adapter.service";
import { PageHeaderComponent } from "../../../../shared/components/page-header/page-header.component";
import { UtcDatePipe } from "../../../../shared/pipes/utc-date.pipe";

const DIAGNOSTICS_PERMISSION = "diagnostics:read";

@Component({
  selector: "app-connector-detail",
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
      <app-page-header [title]="a.name" subtitle="HTTP adapter configuration">
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
            <div class="call-list">
              @for (c of recentCalls(); track $index; let idx = $index) {
                <div
                  class="call-row"
                  [class.expanded]="expandedIdx() === idx"
                  (click)="toggleExpand(idx)"
                  role="button"
                  tabindex="0"
                  (keydown.enter)="toggleExpand(idx)"
                  (keydown.space)="toggleExpand(idx)"
                  [attr.aria-expanded]="expandedIdx() === idx"
                >
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

                  @if (expandedIdx() === idx) {
                    <div class="call-detail" (click)="$event.stopPropagation()">
                      <!-- Request -->
                      <div class="detail-section">
                        <div class="detail-label">Request</div>
                        <div class="detail-row">
                          <span class="detail-sub">URL</span>
                          <pre class="detail-pre mono">{{ c.resolvedUrl }}</pre>
                        </div>
                        @if (c.requestHeaders) {
                          <div class="detail-row">
                            <span class="detail-sub">Headers</span>
                            <pre class="detail-pre mono">{{ formatHeaders(c.requestHeaders) }}</pre>
                          </div>
                        }
                        @if (c.requestBody) {
                          <div class="detail-row">
                            <span class="detail-sub">Body</span>
                            <pre class="detail-pre mono">{{ formatBody(c.requestBody) }}</pre>
                          </div>
                        }
                      </div>

                      <!-- Response -->
                      <div class="detail-section">
                        <div class="detail-label">Response</div>
                        @if (c.responseHeaders) {
                          <div class="detail-row">
                            <span class="detail-sub">Headers</span>
                            <pre class="detail-pre mono">{{ formatHeaders(c.responseHeaders) }}</pre>
                          </div>
                        }
                        @if (c.responseBody) {
                          <div class="detail-row">
                            <span class="detail-sub">Body</span>
                            <pre class="detail-pre mono">{{ formatBody(c.responseBody) }}</pre>
                          </div>
                        }
                      </div>

                      <!-- Cache -->
                      @if (c.cacheResult) {
                        <div class="detail-section">
                          <div class="detail-label">Cache</div>
                          <div class="detail-row">
                            <span class="detail-sub">Result</span>
                            <span
                              class="call-cache"
                              [class.cache-hit]="c.cacheResult === 'hit'"
                              [class.cache-miss]="c.cacheResult === 'miss'"
                              [class.cache-bypass]="c.cacheResult === 'bypass'"
                            >
                              {{ c.cacheResult }}
                            </span>
                          </div>
                          @if (c.cacheKey) {
                            <div class="detail-row">
                              <span class="detail-sub">Key</span>
                              <pre class="detail-pre mono">{{ c.cacheKey }}</pre>
                            </div>
                          }
                          @if (c.cacheTtlSeconds !== undefined) {
                            <div class="detail-row">
                              <span class="detail-sub">TTL</span>
                              <span>{{ c.cacheTtlSeconds }}s</span>
                            </div>
                          }
                        </div>
                      }

                      <!-- Trace link -->
                      @if (c.correlationId) {
                        <div class="detail-section detail-trace">
                          <a [routerLink]="['/processes/trace', c.correlationId]" class="trace-link">
                            <mat-icon>open_in_new</mat-icon>
                            View trace
                          </a>
                        </div>
                      }
                    </div>
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
      margin-bottom: 12px;
    }
    .breadcrumb-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--text3, #94a3b8);
      text-decoration: none;
      font-size: 13px;
    }
    .breadcrumb-link:hover {
      color: var(--text, #e5e7eb);
    }
    .loader {
      display: flex;
      justify-content: center;
      padding: 2rem;
    }
    .error-banner {
      padding: 12px 16px;
      border-radius: 6px;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #ef4444;
      font-size: 13px;
    }
    .section {
      margin-top: 24px;
      padding: 16px;
      border: 1px solid var(--border, rgba(255,255,255,0.08));
      border-radius: 8px;
    }
    .section-title {
      margin: 0 0 12px;
      font-size: 14px;
      font-weight: 600;
      color: var(--text, #e5e7eb);
    }
    .summary-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }
    .summary-card {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 12px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border);
      border-radius: 6px;
    }
    .summary-label {
      font-size: 11px;
      color: var(--text3);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .summary-value {
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
      padding: 4px 8px;
      border-radius: 4px;
    }
    .badge-blue { color: #3b82f6; background: rgba(59, 130, 246, 0.1); }
    .badge-cyan { color: #22d3ee; background: rgba(34, 211, 238, 0.1); }
    .badge-orange { color: #f97316; background: rgba(249, 115, 22, 0.1); }
    .badge-purple { color: #a855f7; background: rgba(168, 85, 247, 0.1); }
    .badge-green { color: #4ade80; background: rgba(74, 222, 128, 0.1); }
    .badge-slate { color: #94a3b8; background: rgba(148, 163, 184, 0.1); }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 12px;
    }
    .info-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .info-label {
      font-size: 11px;
      color: var(--text3, #94a3b8);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .info-value {
      font-size: 13px;
      color: var(--text, #e5e7eb);
    }
    .mono {
      font-family: monospace;
    }
    .endpoints-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .endpoint-card {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
      transition: background-color 0.12s;
    }
    .endpoint-card:hover {
      background: rgba(255, 255, 255, 0.07);
    }
    .endpoint-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 3px;
      background: rgba(34, 211, 238, 0.15);
      color: #22d3ee;
      text-transform: uppercase;
      min-width: 50px;
      text-align: center;
    }
    .endpoint-path {
      flex: 1;
      font-family: monospace;
      font-size: 12px;
      color: var(--text2);
    }
    .endpoint-label {
      font-size: 12px;
      color: var(--text3);
    }
    .endpoint-cache {
      font-size: 11px;
      color: var(--text3);
      white-space: nowrap;
    }
    .no-calls {
      color: var(--text3, #94a3b8);
      font-size: 13px;
      margin: 0;
    }
    .call-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .call-row {
      display: grid;
      grid-template-columns: 160px 60px 50px 70px 1fr auto;
      gap: 8px;
      align-items: center;
      padding: 6px 8px;
      border-radius: 4px;
      background: rgba(255,255,255,0.03);
      font-size: 12px;
      color: var(--text2, #cbd5e1);
      cursor: pointer;
      transition: background-color 0.12s;
      outline: none;
    }
    .call-row:hover,
    .call-row:focus-visible {
      background: rgba(255,255,255,0.07);
      color: var(--text, #e5e7eb);
    }
    .call-ts {
      color: var(--text3, #94a3b8);
      font-size: 11px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .call-method {
      font-family: monospace;
      font-size: 11px;
      font-weight: 600;
      color: var(--cyan, #22d3ee);
    }
    .call-status {
      font-family: monospace;
      font-weight: 600;
      font-size: 12px;
    }
    .st-2xx { color: #4ade80; }
    .st-3xx { color: #facc15; }
    .st-4xx { color: #fb923c; }
    .st-5xx { color: #f87171; }
    .call-dur {
      color: var(--text3, #94a3b8);
      font-size: 11px;
    }
    .call-url {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: monospace;
      font-size: 11px;
    }
    .call-cache {
      font-size: 10px;
      padding: 1px 5px;
      border-radius: 3px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .cache-hit { background: rgba(74,222,128,0.15); color: #4ade80; }
    .cache-miss { background: rgba(251,146,60,0.15); color: #fb923c; }
    .cache-bypass { background: rgba(148,163,184,0.1); color: #94a3b8; }
    .call-detail {
      grid-column: 1 / -1;
      border-top: 1px solid var(--border, rgba(255,255,255,0.08));
      margin-top: 4px;
      padding-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .detail-section {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .detail-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      color: var(--text2, #cbd5e1);
    }
    .detail-row {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-left: 12px;
    }
    .detail-sub {
      font-size: 10px;
      color: var(--text3, #94a3b8);
      text-transform: uppercase;
      letter-spacing: 0.2px;
    }
    .detail-pre {
      margin: 0;
      font-size: 11px;
      background: var(--bg2, rgba(15,23,42,0.5));
      padding: 6px 8px;
      border-radius: 3px;
      overflow-x: auto;
      line-height: 1.4;
      color: var(--text2, #cbd5e1);
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 200px;
      overflow-y: auto;
    }
    .detail-trace {
      margin-top: 4px;
      padding-top: 8px;
      border-top: 1px solid var(--border, rgba(255,255,255,0.08));
    }
    .trace-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--accent, #4f7ef8);
      text-decoration: none;
      transition: color 0.12s;
    }
    .trace-link:hover {
      color: var(--text, #e5e7eb);
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

  readonly adapter = signal<IAdapterDto | null>(null);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly recentCalls = signal<IConnectorCall[]>([]);
  readonly callsLoading = signal(false);
  readonly expandedIdx = signal<number | null>(null);

  readonly canViewCalls = computed(() =>
    this.auth.hasPermission(DIAGNOSTICS_PERMISSION)
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
    this.adapters.get(id).subscribe({
      next: (dto) => {
        this.adapter.set(dto);
        this.loading.set(false);
        this.loadCalls(id);
      },
      error: () => {
        this.errorMessage.set("Failed to load connector.");
        this.loading.set(false);
      },
    });
  }

  private loadCalls(id: string): void {
    if (!this.canViewCalls()) {
      return;
    }
    this.callsLoading.set(true);
    this.calls.recentCalls(id, undefined, 20).subscribe({
      next: (rows) => {
        this.recentCalls.set(rows);
        this.callsLoading.set(false);
      },
      error: () => {
        this.callsLoading.set(false);
      },
    });
  }

  protected toggleExpand(idx: number): void {
    this.expandedIdx.update((cur) => (cur === idx ? null : idx));
  }

  protected formatHeaders(headers: Record<string, string> | undefined): string {
    if (!headers) {
      return "";
    }
    return Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
  }

  protected formatBody(body: unknown): string {
    if (body === undefined || body === null) {
      return "";
    }
    if (typeof body === "string") {
      return body;
    }
    return JSON.stringify(body, null, 2);
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
