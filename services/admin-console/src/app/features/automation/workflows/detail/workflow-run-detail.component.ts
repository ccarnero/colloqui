import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  effect,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute, Router } from "@angular/router";
import { environment } from "../../../../../environments/environment";
import { BreadcrumbsComponent } from "../../../../shared/components/breadcrumbs/breadcrumbs.component";
import { UtcDatePipe } from "../../../../shared/pipes/utc-date.pipe";
import {
  type IWorkflowExecutionDetail,
  WorkflowApiService,
} from "../services/workflow-api.service";

type StepKind = "ok" | "fail" | "skip" | "run";

interface IStep {
  name: string;
  kind: StepKind;
  /** Pretty-printed result/input/error JSON, or null if not available. */
  payload: string | null;
}

/**
 * Single execution detail page — replaces the in-popup detail view.
 *
 * Route: /workflows/:id/runs/:runId
 *
 * Renders a vertical step list with status-bordered rows. Selecting a
 * step shows its payload (input or output, depending on whether the
 * step ran or failed) in the panel below. Retry-from-here is currently
 * a placeholder action — the API doesn't expose it yet.
 */
@Component({
  selector: "app-workflow-run-detail",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UtcDatePipe, BreadcrumbsComponent],
  template: `
    <div class="run">
      <app-breadcrumbs [crumbs]="crumbs()" />

      @if (loading()) {
        <p class="empty">Loading run…</p>
      }

      @if (!loading() && detail(); as d) {
        <header class="run-h">
          <div class="run-h-text">
            <h1 class="run-title">
              Run · {{ shortId(d.executionId) }}
              <span class="status-pill" [class]="'sp-' + statusClass(d.status)">
                <span class="dot"></span>{{ d.status }}
              </span>
            </h1>
          </div>
          <div class="run-actions">
            @if (temporalUrl(); as url) {
              <a class="temporal-link" [href]="url" target="_blank" rel="noopener">
                Open in Temporal
              </a>
            }
            <button class="btn" type="button" (click)="back()">Back</button>
            <button class="btn btn-primary" type="button" (click)="retry()">
              Retry
            </button>
          </div>
        </header>

        <div class="meta">
          <div class="meta-cell">
            <div class="meta-l">Started</div>
            <div class="meta-v">{{ d.createdAt | utcDate: "medium" }}</div>
          </div>
          <div class="meta-cell">
            <div class="meta-l">Status</div>
            <div class="meta-v">{{ d.status }}</div>
          </div>
          <div class="meta-cell">
            <div class="meta-l">Temporal workflow</div>
            <div class="meta-v mono">{{ d.temporalWorkflowId }}</div>
          </div>
          <div class="meta-cell">
            <div class="meta-l">Definition</div>
            <div class="meta-v mono">{{ d.definitionId }}</div>
          </div>
        </div>

        <section class="steps">
          @for (s of steps(); track s.name; let i = $index) {
            <button
              type="button"
              class="step"
              [class]="'step-' + s.kind"
              [class.selected]="selectedIndex() === i"
              [class.step-highlight]="s.name === deepLinkNodeName()"
              [attr.data-testid]="s.name === deepLinkNodeName() ? 'step-highlighted' : null"
              (click)="select(i)"
            >
              <span class="step-name">{{ s.name }}</span>
              <span class="step-kind">{{ s.kind }}</span>
            </button>
          } @empty {
            <p class="empty">No per-step results available.</p>
          }
        </section>

        @if (selectedStep(); as s) {
          <section class="detail">
            <h3 class="detail-h">{{ s.name }}</h3>
            @if (s.payload) {
              <pre class="code" [class.err]="s.kind === 'fail'">{{ s.payload }}</pre>
            } @else {
              <p class="empty">No payload recorded for this step.</p>
            }
          </section>
        }

        @if (d.failure; as f) {
          <section class="detail err-panel">
            <h3 class="detail-h">Failure</h3>
            <p class="err-msg">{{ f.message }}</p>
            @if (f.activityName) {
              <p class="err-sub">at activity {{ f.activityName }}</p>
            }
            @if (f.cause) {
              <pre class="code err">{{ f.cause }}</pre>
            }
          </section>
        }
      }

      @if (!loading() && !detail() && error()) {
        <p class="empty err-msg">Failed to load this run: {{ error() }}</p>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .run {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .run-h {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }
    .run-title {
      font-size: 18px;
      font-weight: 500;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .status-pill {
      font-size: 11px;
      padding: 3px 9px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-weight: 500;
    }
    .sp-ok {
      background: color-mix(in srgb, var(--green, #16a34a) 15%, transparent);
      color: var(--green, #16a34a);
    }
    .sp-fail {
      background: color-mix(in srgb, var(--red, #ef4444) 15%, transparent);
      color: var(--red, #ef4444);
    }
    .sp-running {
      background: color-mix(in srgb, var(--primary, #1a66ff) 15%, transparent);
      color: var(--primary, #1a66ff);
    }
    .sp-other { background: var(--bg3); color: var(--text2); }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: 0.85; }
    .run-actions { display: flex; gap: 6px; align-items: center; }
    .temporal-link {
      display: inline-flex;
      align-items: center;
      font-size: 12px;
      padding: 6px 12px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      text-decoration: none;
      color: var(--text-primary);
      background: var(--bg-surface);
    }
    .temporal-link:hover { background: var(--bg3); }
    .btn {
      font-size: 12px;
      padding: 6px 12px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      background: var(--bg-surface);
      color: var(--text-primary);
      cursor: pointer;
    }
    .btn:hover { background: var(--bg3); }
    .btn-primary {
      background: var(--primary, #1a66ff);
      color: #fff;
      border-color: var(--primary, #1a66ff);
    }
    .meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 8px;
      padding: 12px 14px;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
    }
    .meta-l { font-size: 11px; color: var(--text2); }
    .meta-v {
      font-size: 12px;
      font-weight: 500;
      margin-top: 3px;
      color: var(--text-primary);
    }
    .meta-v.mono { font-family: var(--font-mono, monospace); font-size: 11px; }
    .steps {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      overflow: hidden;
    }
    .step {
      display: flex;
      width: 100%;
      align-items: center;
      gap: 12px;
      padding: 9px 14px;
      border: none;
      border-bottom: 1px solid var(--border-subtle);
      border-left: 3px solid transparent;
      background: transparent;
      color: inherit;
      cursor: pointer;
      text-align: left;
      font: inherit;
      border-radius: 0;
    }
    .step:last-child { border-bottom: none; }
    .step.step-ok { border-left-color: var(--green, #16a34a); }
    .step.step-fail { border-left-color: var(--red, #ef4444); }
    .step.step-skip { border-left-color: var(--border-subtle); opacity: 0.6; }
    .step.step-run { border-left-color: var(--primary, #1a66ff); }
    .step.selected {
      background: var(--accent-dim, rgba(26, 102, 255, 0.06));
    }
    /* Deep-link highlight (shape-scoped inspector correction) — the step
     * a builder inspector's "View in Runs" link pointed at. Distinct from
     * .selected (click state) so both can be visible at once; kept
     * subtle per the mock's ".rv-step.hl" (yellow border/tint). */
    .step.step-highlight {
      border-left-color: var(--yellow, #f5a623);
      background: var(--yellow-dim, rgba(245, 166, 35, 0.08));
    }
    .step-name {
      flex: 1;
      font-size: 12px;
      color: var(--text-primary);
      font-family: var(--font-mono, monospace);
    }
    .step-kind {
      font-size: 11px;
      color: var(--text3);
    }
    .detail {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      padding: 12px 14px;
    }
    .detail-h {
      font-size: 12px;
      font-weight: 500;
      margin: 0 0 8px;
    }
    .err-panel { border-color: var(--red, #ef4444); }
    .err-msg { color: var(--red, #ef4444); margin: 0 0 6px; font-size: 12px; }
    .err-sub { color: var(--text2); margin: 0 0 6px; font-size: 11px; }
    .code {
      background: var(--bg-background);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      padding: 8px 10px;
      font-family: var(--font-mono, monospace);
      font-size: 11px;
      color: var(--text-primary);
      white-space: pre-wrap;
      margin: 0;
      overflow-x: auto;
    }
    .code.err { color: var(--red, #ef4444); }
    .empty { font-size: 12px; color: var(--text3); padding: 12px; text-align: center; }
  `,
})
export class WorkflowRunDetailComponent implements OnInit {
  private readonly api = inject(WorkflowApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  private readonly parentParams = toSignal(
    this.route.parent?.params ?? this.route.params,
    { initialValue: this.route.parent?.snapshot.params ?? {} }
  );
  private readonly ownParams = toSignal(this.route.params, {
    initialValue: this.route.snapshot.params,
  });
  private readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: this.route.snapshot.queryParams,
  });

  readonly definitionId = computed<string>(
    () => this.parentParams()["id"] ?? ""
  );
  readonly runId = computed<string>(() => this.ownParams()["runId"] ?? "");
  /**
   * Deep-link node query param (shape-scoped inspector correction) — set
   * by the builder inspector's "View in Runs" link
   * (`workflow-builder.component.ts`'s `onViewInRuns`), possibly forwarded
   * through `WorkflowExecutionsComponent`. `null` (absent) leaves the step
   * list's rendering entirely unchanged — no highlight, no scroll.
   */
  readonly deepLinkNodeName = computed<string | null>(() => {
    const raw = this.queryParams()["node"];
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  });

  readonly detail = signal<IWorkflowExecutionDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly selectedIndex = signal(0);

  readonly steps = computed<IStep[]>(() => {
    const d = this.detail();
    if (!d) {
      return [];
    }
    const out: IStep[] = [];
    const results = (d.result?.results ?? {}) as Record<string, unknown>;
    const failedActivity = d.failure?.activityName ?? null;
    const isFail = (d.failure ?? null) !== null;

    for (const [name, payload] of Object.entries(results)) {
      out.push({
        name,
        kind: "ok",
        payload: stringifyPayload(payload),
      });
    }

    if (failedActivity && !out.some((s) => s.name === failedActivity)) {
      out.push({
        name: failedActivity,
        kind: "fail",
        payload: d.failure?.cause ?? d.failure?.message ?? null,
      });
    } else if (failedActivity) {
      const idx = out.findIndex((s) => s.name === failedActivity);
      if (idx !== -1) {
        out[idx]!.kind = "fail";
      }
    }

    if (out.length === 0 && isFail && d.failure) {
      // Backend didn't return per-step results, but we know it failed.
      out.push({
        name: d.failure.activityName ?? "execution",
        kind: "fail",
        payload: d.failure.cause ?? d.failure.message,
      });
    }

    return out;
  });

  readonly selectedStep = computed(() => {
    const list = this.steps();
    const i = this.selectedIndex();
    return list[i] ?? list[0] ?? null;
  });

  readonly crumbs = computed(() => [
    { label: "Workflows", route: "/workflows" },
    {
      label: this.shortDefId(),
      route: `/workflows/${this.definitionId()}`,
    },
    { label: this.shortId(this.runId()) },
  ]);

  readonly temporalUrl = computed<string | null>(() => {
    const d = this.detail();
    const base = environment.temporalUiBaseUrl;
    if (!base || !d?.temporalWorkflowId) {
      return null;
    }
    const wf = encodeURIComponent(d.temporalWorkflowId);
    const run = d.temporalRunId ? encodeURIComponent(d.temporalRunId) : null;
    const ns = environment.temporalNamespace;
    return run
      ? `${base}/namespaces/${ns}/workflows/${wf}/${run}`
      : `${base}/namespaces/${ns}/workflows/${wf}`;
  });

  constructor() {
    // Deep-link scroll (shape-scoped inspector correction): once the step
    // list renders AND a `?node=` param names a step in it, scrolls the
    // highlighted `.step-highlight` button into view. `queueMicrotask`
    // waits for the `@for` block driven by `steps()`/`deepLinkNodeName()`
    // to flush into the DOM before querying it. No-op whenever the param
    // is absent (`deepLinkNodeName()` null) or names no step in this run.
    effect(() => {
      const nodeName = this.deepLinkNodeName();
      const stepNames = this.steps().map((s) => s.name);
      if (!nodeName || !stepNames.includes(nodeName)) {
        return;
      }
      queueMicrotask(() => {
        const el =
          this.elementRef.nativeElement.querySelector(".step-highlight");
        // Test-environment guard: jsdom (this app's spec runner) does not
        // implement scrollIntoView — a real browser always has it.
        el?.scrollIntoView?.({ block: "nearest" });
      });
    });
  }

  ngOnInit(): void {
    const def = this.definitionId();
    const run = this.runId();
    if (!def || !run) {
      this.loading.set(false);
      return;
    }
    this.api.getExecutionDetail(def, run).subscribe({
      next: (d) => {
        this.detail.set(d);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(String(err?.message ?? err));
        this.loading.set(false);
      },
    });
  }

  protected select(i: number): void {
    this.selectedIndex.set(i);
  }

  protected back(): void {
    void this.router.navigate([
      "/workflows",
      this.definitionId(),
      "executions",
    ]);
  }

  protected retry(): void {
    /* PHASE 3 TODO: wire to API once retry endpoint exists. */
  }

  protected statusClass(status: string): "ok" | "fail" | "running" | "other" {
    const s = status.toLowerCase();
    if (s.includes("complete") || s === "ok" || s === "success") {
      return "ok";
    }
    if (s.includes("fail") || s.includes("error")) {
      return "fail";
    }
    if (s.includes("run")) {
      return "running";
    }
    return "other";
  }

  protected shortId(id: string): string {
    return id.length > 8 ? id.slice(0, 8) : id;
  }

  protected shortDefId(): string {
    const id = this.definitionId();
    return id.length > 12 ? id.slice(0, 12) : id;
  }
}

/**
 * Pretty-prints arbitrary payload values. Strings pass through as-is;
 * objects and arrays go through JSON.stringify with 2-space indent.
 */
function stringifyPayload(v: unknown): string | null {
  if (v === null || v === undefined) {
    return null;
  }
  if (typeof v === "string") {
    return v;
  }
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
