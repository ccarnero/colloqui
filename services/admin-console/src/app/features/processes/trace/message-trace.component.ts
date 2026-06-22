import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type OnInit,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute } from "@angular/router";
import { environment } from "../../../../environments/environment";
import { AuthService } from "../../../core/services/auth.service";
import {
  MessageTraceService,
  type ITraceView,
} from "../../../core/services/message-trace.service";
import type {
  IRecentTrace,
  ITraceNode,
  TraceVerdict,
} from "./domain/message-trace.model";

const PERMISSION = "diagnostics:read";

@Component({
  selector: "app-message-trace",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @if (!canView()) {
      <div class="mt-deny">
        <strong>Access restricted</strong>
        <p>The message trace requires the <code>${PERMISSION}</code> permission.</p>
      </div>
    } @else {
      <header class="mt-head">
        <div>
          <h1>Message trace</h1>
          <span class="mt-sub">Processes › Diagnostics</span>
        </div>
      </header>

      <div class="mt-bar">
        <div class="mt-seg" role="group" aria-label="Search mode">
          <button
            type="button"
            [class.mt-seg-on]="mode() === 'correlation'"
            (click)="setMode('correlation')"
          >correlation</button>
          <button
            type="button"
            [class.mt-seg-on]="mode() === 'event'"
            (click)="setMode('event')"
          >event id</button>
        </div>
        <input
          class="mt-input"
          [ngModel]="cidInput()"
          (ngModelChange)="cidInput.set($event)"
          (keyup.enter)="trace(cidInput())"
          [placeholder]="
            mode() === 'event'
              ? 'event id — resolves to its correlation, then walks up to the origin'
              : 'correlation id'
          "
          [attr.aria-label]="mode() === 'event' ? 'Event ID' : 'Correlation ID'"
        />
        <button class="mt-btn" (click)="trace(cidInput())">Trace</button>
      </div>

      <section class="mt-recent">
        <div class="mt-recent-head">
          <span>Recent traces · last 10 (business + tech ids)</span>
          <button class="mt-link" (click)="loadRecent()">refresh</button>
        </div>
        @if (recent().length) {
          <select
            class="mt-combo"
            #sel
            (change)="pickRecent(sel.value); sel.selectedIndex = 0"
            aria-label="Pick a recent trace"
          >
            <option value="" selected>Pick a recent trace…</option>
            @for (r of recent(); track r.correlationId) {
              <option [value]="r.correlationId">
                {{ shortId(r.correlationId) }} · {{ r.channel }} · {{ verdictLabel(r.verdict) }}{{ r.traceId ? '  ·  trace ' + shortId(r.traceId) : '' }} · {{ r.lastAt }}
              </option>
            }
          </select>
        } @else {
          <p class="mt-muted">No recent traces found.</p>
        }
      </section>

      @if (loading()) {
        <p class="mt-muted">Loading…</p>
      }
      @if (error()) {
        <p class="mt-error">{{ error() }}</p>
      }

      @if (view(); as v) {
        <div class="mt-keys">
          <span class="mt-tag mt-biz">business</span>
          <span>correlation <span class="mt-mono">{{ v.result.correlationId }}</span></span>
          @if (v.traceId) {
            <span class="mt-tag">tech</span>
            <span>traceid <span class="mt-mono">{{ v.traceId }}</span></span>
            @if (tempoUrl(v); as url) {
              <a [href]="url" target="_blank" rel="noopener">Open in Tempo</a>
            }
          }
        </div>

        <div [class]="bannerClass(v.result.verdict)">
          {{ verdictBanner(v.result.verdict) }}
        </div>

        @if (v.result.nodeCount > 0) {
          <div class="mt-dir" role="group" aria-label="Direction">
            <button
              type="button"
              [class.mt-seg-on]="direction() === 'forward'"
              (click)="direction.set('forward')"
            >forward · origin → reply</button>
            <button
              type="button"
              [class.mt-seg-on]="direction() === 'reverse'"
              (click)="direction.set('reverse')"
            >reverse · reply → origin</button>
          </div>
        } @else {
          <p class="mt-muted">No events for this correlation in the selected window.</p>
        }

        @for (n of nodesToShow(v); track n.id; let i = $index) {
          @if (direction() === 'reverse' && i > 0) {
            <div class="mt-cause"><span aria-hidden="true">▲</span> caused by</div>
          }
          <article class="mt-node" [class.mt-selected]="n.id === selectedId()">
            <div class="mt-node-head">
              <span style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span [class]="verdictClass(nodeVerdict(n))">{{ nodeLabel(n.kind) }}</span>
                <span class="mt-muted">{{ nodeHint(n.kind) }}</span>
                <span class="mt-svc">{{ producerOf(n) }}</span>
                @if (n.id === selectedId()) {
                  <span class="mt-tag mt-biz">you searched this</span>
                }
                @if (isOrigin(n)) { <span class="mt-tag">origin</span> }
              </span>
              <span class="mt-mono mt-muted">{{ n.createdAt }}</span>
            </div>
            <dl class="mt-dl">
              @if (n.subject) {
                <dt>subject</dt><dd class="mt-mono">{{ n.subject }}</dd>
              }
              <dt>id</dt><dd class="mt-mono">{{ n.id }}</dd>
              <dt>causation</dt>
              <dd class="mt-mono">{{ n.causationId || '— root' }}</dd>
              <dt>depth</dt><dd class="mt-mono">{{ n.depth }}</dd>
              @if (n.from) { <dt>from</dt><dd class="mt-mono">{{ n.from }}</dd> }
              @if (n.to) { <dt>to</dt><dd class="mt-mono">{{ n.to }}</dd> }
              @if (n.subject && stream()) {
                <dt>stream</dt><dd class="mt-mono">{{ stream() }}</dd>
              }
              @if (persistedIn(n); as p) {
                <dt>persisted</dt>
                <dd>
                  <span class="mt-mono">{{ p.table }}</span>
                  <span class="mt-muted">· {{ p.service }}</span>
                </dd>
              }
            </dl>
            @if (n.kind === 'workflow run' && temporalUrl(v); as url) {
              <a
                class="mt-temporal"
                [href]="url"
                target="_blank"
                rel="noopener"
              >Open in Temporal</a>
            }
            @if (n.subscribers.length) {
              <div class="mt-transport">
                <span class="mt-muted">delivered to {{ n.subscribers.length }}</span>
                @for (s of n.subscribers; track s.durable) {
                  <div class="mt-row mt-sub">
                    <span><b>{{ s.service }}</b> · <span class="mt-mono">{{ s.durable }}</span>
                      <span class="mt-tag">{{ s.role === 'producer' ? '→ next' : 'sink' }}</span></span>
                    <span class="mt-muted">{{ healthLabel(s) }}</span>
                  </div>
                }
              </div>
            }
          </article>
        }
      }
    }
  `,
  styles: `
    :host { display: block; padding: 16px; }
    h1 { font-size: 18px; margin: 0; }
    .mt-sub, .mt-muted { color: var(--text-muted, #888); font-size: 12px; }
    .mt-head { margin-bottom: 12px; }
    .mt-bar { display: flex; gap: 8px; margin-bottom: 16px; align-items: stretch; flex-wrap: wrap; }
    .mt-input { flex: 1; min-width: 220px; height: 38px; padding: 0 12px; border: 1px solid var(--border,#d8d8d8); border-radius: 8px; font-size: 14px; background: var(--bg,#fff); color: var(--text, inherit); outline: none; box-sizing: border-box; }
    .mt-input:focus { border-color: var(--text-info,#185fa5); box-shadow: 0 0 0 3px var(--bg-info,#e6f1fb); }
    .mt-btn { height: 38px; padding: 0 18px; border-radius: 8px; border: 1px solid var(--text-info,#185fa5); background: var(--text-info,#185fa5); color: #fff; font-size: 14px; font-weight: 500; cursor: pointer; }
    .mt-btn:hover { filter: brightness(1.06); }
    .mt-seg { display: inline-flex; border: 1px solid var(--border,#d8d8d8); border-radius: 8px; overflow: hidden; }
    .mt-seg button { height: 38px; padding: 0 12px; border: none; border-right: 1px solid var(--border,#eee); background: var(--bg,#fff); color: var(--text-muted,#666); font-size: 13px; cursor: pointer; }
    .mt-seg button:last-child { border-right: none; }
    .mt-seg-on { background: var(--bg-info,#e6f1fb); color: var(--text-info,#185fa5); font-weight: 500; }
    .mt-dir { display: inline-flex; border: 1px solid var(--border,#d8d8d8); border-radius: 8px; overflow: hidden; margin-bottom: 16px; }
    .mt-dir button { padding: 6px 14px; border: none; border-right: 1px solid var(--border,#eee); background: var(--bg,#fff); color: var(--text-muted,#666); font-size: 12px; cursor: pointer; }
    .mt-dir button:last-child { border-right: none; }
    .mt-cause { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; color: var(--text-muted,#888); padding: 4px 0; }
    .mt-node.mt-selected { border-color: var(--text-info,#185fa5); box-shadow: 0 0 0 1px var(--text-info,#185fa5); }
    .mt-svc { font-size: 11px; padding: 2px 8px; border-radius: 6px; background: var(--bg2,#eceef2); color: var(--text-muted,#555); font-weight: 500; }
    .mt-dl { display: grid; grid-template-columns: 88px minmax(0,1fr); gap: 3px 12px; font-size: 12px; margin: 8px 0 0; align-items: baseline; }
    .mt-dl dt { color: var(--text-muted,#888); }
    .mt-dl dd { margin: 0; color: var(--text, inherit); word-break: break-all; }
    .mt-temporal { display: inline-flex; align-items: center; gap: 6px; margin-top: 10px; font-size: 13px; padding: 6px 12px; border: 1px solid var(--border,#d8d8d8); border-radius: 8px; text-decoration: none; color: var(--text, inherit); }
    .mt-temporal:hover { background: var(--bg2,#f3f3f3); }
    .mt-recent { background: var(--bg2, #f5f5f5); border-radius: 8px; padding: 8px; margin-bottom: 16px; }
    .mt-recent-head { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-muted,#888); margin: 2px 4px 6px; }
    .mt-combo { width: 100%; height: 38px; padding: 0 12px; border: 1px solid var(--border,#d8d8d8); border-radius: 8px; background: var(--bg,#fff); color: var(--text, inherit); font-size: 13px; font-family: var(--font-mono, inherit); cursor: pointer; box-sizing: border-box; }
    .mt-combo:focus { outline: none; border-color: var(--text-info,#185fa5); box-shadow: 0 0 0 3px var(--bg-info,#e6f1fb); }
    .mt-recent-row { display: flex; gap: 12px; align-items: center; width: 100%; text-align: left; background: none; border: none; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
    .mt-recent-row.mt-active { background: var(--bg-info, #e6f1fb); }
    .mt-keys { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; border: 1px solid var(--border,#ddd); border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; font-size: 12px; }
    .mt-node { border: 1px solid var(--border,#ddd); border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; }
    .mt-node-head { display: flex; justify-content: space-between; margin-bottom: 6px; }
    .mt-subject { font-size: 12px; word-break: break-all; margin-bottom: 8px; }
    .mt-row { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 12px; color: var(--text-muted,#888); }
    .mt-sub { padding: 4px 0; }
    .mt-transport { border-top: 1px solid var(--border,#eee); margin-top: 10px; padding-top: 6px; }
    .mt-mono { font-family: var(--font-mono, monospace); color: var(--text, inherit); }
    .mt-tag { font-size: 11px; padding: 1px 7px; border-radius: 6px; background: var(--bg2,#eee); }
    .mt-biz { background: var(--bg-info,#e6f1fb); }
    .mt-ok { color: var(--text-success, #1d7a4d); }
    .mt-warn { color: var(--text-warning, #946200); }
    .mt-bad { color: var(--text-danger, #b3261e); }
    .mt-link { background: none; border: none; cursor: pointer; color: var(--text-info,#185fa5); }
    .mt-banner { border-radius: 6px; padding: 10px 12px; margin-bottom: 16px; font-size: 13px; }
    .mt-banner.mt-bad { background: var(--bg-danger,#fcebeb); }
    .mt-banner.mt-warn { background: var(--bg-warning,#faeeda); }
    .mt-banner.mt-ok { background: var(--bg-success,#eaf3de); }
    .mt-deny, .mt-error { color: var(--text-danger,#b3261e); }
  `,
})
export class MessageTraceComponent implements OnInit {
  private readonly traceService = inject(MessageTraceService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  readonly cidInput = signal("");
  readonly recent = signal<IRecentTrace[]>([]);
  readonly view = signal<ITraceView | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Search by `correlation` (forward) or `event` id (reverse to origin). */
  readonly mode = signal<"correlation" | "event">("correlation");
  readonly direction = signal<"forward" | "reverse">("forward");
  /** The event id the user searched (event mode) — highlighted in the chain. */
  readonly selectedId = signal<string | null>(null);

  readonly canView = computed(() => this.auth.hasPermission(PERMISSION));

  setMode(mode: "correlation" | "event"): void {
    this.mode.set(mode);
  }

  ngOnInit(): void {
    if (!this.canView()) return;
    this.loadRecent();
    const cid = this.route.snapshot.paramMap.get("correlationId");
    if (cid) {
      this.cidInput.set(cid);
      this.trace(cid);
    }
  }

  loadRecent(): void {
    this.traceService.recentTraces().subscribe({
      next: (r) => this.recent.set(r),
      error: () => this.recent.set([]),
    });
  }

  /** Search box dispatch: correlation → forward; event id → resolve then reverse. */
  trace(value: string): void {
    const v = value.trim();
    if (!v) return;
    this.cidInput.set(v);
    this.error.set(null);
    if (this.mode() === "event") {
      this.selectedId.set(v);
      this.direction.set("reverse");
      this.loading.set(true);
      this.traceService.resolveCorrelation(v).subscribe({
        next: (cid) => {
          if (!cid) {
            this.error.set("Event id not found in audit.");
            this.loading.set(false);
            return;
          }
          this.loadTrace(cid);
        },
        error: () => {
          this.error.set("Lookup failed.");
          this.loading.set(false);
        },
      });
    } else {
      this.selectedId.set(null);
      this.direction.set("forward");
      this.loadTrace(v);
    }
  }

  /** Recent rows are always correlations — force correlation/forward. */
  pickRecent(correlationId: string): void {
    this.mode.set("correlation");
    this.selectedId.set(null);
    this.direction.set("forward");
    this.cidInput.set(correlationId);
    this.loadTrace(correlationId);
  }

  private loadTrace(correlationId: string): void {
    const cid = correlationId.trim();
    if (!cid) return;
    this.loading.set(true);
    this.error.set(null);
    this.traceService.getTrace(cid).subscribe({
      next: (v) => {
        this.view.set(v);
        this.loading.set(false);
      },
      error: () => {
        this.error.set("Failed to load trace.");
        this.loading.set(false);
      },
    });
  }

  /** Nodes in display order: forward (created_at) or reverse (leaf → origin). */
  nodesToShow(v: ITraceView): readonly ITraceNode[] {
    return this.direction() === "reverse"
      ? [...v.result.nodes].reverse()
      : v.result.nodes;
  }

  isOrigin(n: ITraceNode): boolean {
    const v = this.view();
    return !!v && v.result.root?.id === n.id;
  }

  /** Producing service from the subject's producer token (evt.<tenant>.<producer>…). */
  producerOf(n: ITraceNode): string {
    if (n.kind === "workflow run") return "workflow-service";
    const tokens = n.subject.split(".");
    return tokens.length >= 3 && tokens[2] ? tokens[2] : "—";
  }

  /**
   * The real per-tenant JetStream stream — mirrors `getTenantStreamName` in
   * `@yoizen/shared`: `INGRESS-<TENANT uppercased>`. One stream per tenant
   * captures `evt.<tenant>.>`, so every node lives on it.
   */
  readonly stream = computed(() => {
    const t = this.auth.tenantId();
    return t ? `INGRESS-${t.toUpperCase()}` : "";
  });

  /** Durable store a node is persisted in, or null when it isn't persisted. */
  persistedIn(n: ITraceNode): { table: string; service: string } | null {
    if (n.kind === "workflow run") {
      return { table: "workflow_executions", service: "workflow-service" };
    }
    if (n.source === "channel") {
      return { table: "channel_events", service: "audit-service" };
    }
    if (n.source === "platform") {
      return { table: "events", service: "audit-service" };
    }
    return null;
  }

  temporalUrl(v: ITraceView): string | null {
    const base = environment.temporalUiBaseUrl;
    if (!base || !v.temporalWorkflowId) return null;
    return `${base}/namespaces/${environment.temporalNamespace}/workflows/${encodeURIComponent(v.temporalWorkflowId)}`;
  }

  tempoUrl(v: ITraceView): string | null {
    const base = environment.tempoBaseUrl;
    if (!base || !v.traceId) return null;
    return `${base}?traceid=${encodeURIComponent(v.traceId)}`;
  }

  shortId(id: string): string {
    return id.length > 10 ? `${id.slice(0, 8)}…` : id;
  }

  nodeVerdict(n: ITraceNode): TraceVerdict {
    if (n.kind === "received") return "received";
    if (n.kind === "sent") return "replied";
    if (n.kind === "workflow run") return "received";
    if (n.delivery === "failed") return "failed";
    return "published-unconfirmed";
  }

  /** Human label for a node — `send`/`sent` are otherwise easy to confuse. */
  nodeLabel(kind: string): string {
    const map: Record<string, string> = {
      received: "received",
      "workflow run": "workflow run",
      send: "reply queued",
      sent: "reply delivered",
    };
    return map[kind] ?? kind;
  }

  /** One-line explanation of the stage. */
  nodeHint(kind: string): string {
    const map: Record<string, string> = {
      received: "inbound message arrived",
      "workflow run": "workflow executed",
      send: "reply command on the bus — egress will deliver it",
      sent: "provider confirmed delivery",
    };
    return map[kind] ?? "";
  }

  verdictLabel(v: TraceVerdict): string {
    const map: Record<TraceVerdict, string> = {
      received: "received",
      replied: "delivered",
      "published-unconfirmed": "not confirmed",
      failed: "failed",
      empty: "empty",
    };
    return map[v];
  }

  verdictClass(v: TraceVerdict): string {
    if (v === "replied" || v === "received") return "mt-ok";
    if (v === "failed") return "mt-bad";
    return "mt-warn";
  }

  bannerClass(v: TraceVerdict): string {
    return `mt-banner ${this.verdictClass(v)}`;
  }

  verdictBanner(v: TraceVerdict): string {
    const map: Record<TraceVerdict, string> = {
      received: "Message received; no reply was produced.",
      replied: "Round trip complete — reply delivered.",
      "published-unconfirmed":
        "Reply was published, but delivery isn't confirmed in audit. Open the run in Temporal for the activity result.",
      failed: "Reply failed downstream — see the egress consumer / Temporal.",
      empty: "No events found for this correlation.",
    };
    return map[v];
  }

  healthLabel(s: { health?: { pending?: number; circuitOpen?: boolean } }): string {
    if (!s.health) return "—";
    if (s.health.circuitOpen) return "circuit open";
    return `pending ${s.health.pending ?? 0}`;
  }
}
