import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  inject,
  OnChanges,
  Output,
  SimpleChanges,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { firstValueFrom } from "rxjs";
import { stringifyPayload } from "../../../domain/stringify-payload";
import {
  type IWorkflowExecutionDetail,
  WorkflowApiService,
} from "../../../services/workflow-api.service";

interface ITestStep {
  name: string;
  kind: "ok" | "fail" | "running";
  payload: string | null;
  expanded: boolean;
}

/**
 * Right-side drawer that lets the user execute a workflow definition
 * inline and inspect per-step results. Replaces / overlays the config
 * panel area while open.
 */
@Component({
  selector: "app-workflow-test-panel",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatFormFieldModule, MatInputModule],
  template: `
    <div class="test-panel">
      <header class="tp-header">
        <h3 class="tp-title">Test Run</h3>
        <button type="button" class="tp-close" (click)="closePanel()" title="Close test panel">
          ✕
        </button>
      </header>

      <div class="tp-body">
        <!-- IDLE state -->
        @if (status() === "idle") {
          @if (requestVars().length > 0) {
            <div class="tp-inputs">
              <div class="tp-inputs-label">Request Variables</div>
              @for (v of requestVars(); track v) {
                <mat-form-field appearance="outline" class="tp-input-field">
                  <mat-label>{{ v }}</mat-label>
                  <input
                    matInput
                    [ngModel]="requestValues()[v]"
                    (ngModelChange)="onRequestVarChange(v, $event)"
                    [placeholder]="'Value for ' + v"
                  />
                </mat-form-field>
              }
            </div>
          }
          <button type="button" class="tp-run-btn" (click)="run()">
            ▶ Run Test
          </button>
        }

        <!-- RUNNING state -->
        @if (status() === "running") {
          <div class="tp-status">
            <span class="tp-spinner">⟳</span>
            Running workflow…
          </div>
          <div class="tp-elapsed">Elapsed: {{ elapsed() }}</div>
        }

        <!-- COMPLETED / FAILED state -->
        @if (status() === "completed" || status() === "failed") {
          <div class="tp-status" [class.tp-ok]="status() === 'completed'" [class.tp-fail]="status() === 'failed'">
            <span class="tp-icon">{{ status() === "completed" ? "✅" : "❌" }}</span>
            {{ status() === "completed" ? "completed" : "failed" }}
          </div>
          <div class="tp-elapsed">Duration: {{ elapsed() }}</div>

          <!-- Steps -->
          <div class="tp-steps">
            @for (step of steps(); track step.name; let i = $index) {
              <div class="tp-step" [class.tp-step-fail]="step.kind === 'fail'">
                <div class="tp-step-head" (click)="toggleStep(i)">
                  <span class="tp-step-icon">
                    @if (step.kind === "ok") { ✅ }
                    @if (step.kind === "fail") { ❌ }
                    @if (step.kind === "running") { ⟳ }
                  </span>
                  <span class="tp-step-name">{{ step.name }}</span>
                  @if (step.payload) {
                    <span class="tp-step-toggle">
                      {{ step.expanded ? "▼" : "▶" }}
                    </span>
                  }
                </div>
                @if (step.expanded && step.payload) {
                  <pre class="tp-step-payload">{{ step.payload }}</pre>
                }
              </div>
            } @empty {
              <p class="tp-empty">No step results available.</p>
            }
          </div>

          <button type="button" class="tp-run-btn" (click)="rerun()">
            🔄 Run Again
          </button>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      width: 360px;
      min-width: 360px;
      max-width: 420px;
      background: var(--bg-surface, var(--bg2));
      border-left: 1px solid var(--border);
      overflow: hidden;
      box-sizing: border-box;
    }
    .test-panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }
    .tp-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .tp-title {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
    }
    .tp-close {
      background: none;
      border: none;
      color: var(--text2);
      cursor: pointer;
      font-size: 16px;
      padding: 2px 6px;
      border-radius: 4px;
      line-height: 1;
    }
    .tp-close:hover {
      background: var(--bg3);
      color: var(--text-primary);
    }
    .tp-body {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px;
      overflow-y: auto;
      flex: 1;
    }
    .tp-run-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      padding: 8px 16px;
      border: 1px solid var(--border);
      border-radius: var(--radius, 6px);
      background: var(--accent, #6366f1);
      color: #fff;
      cursor: pointer;
      font-family: inherit;
      align-self: flex-start;
    }
    .tp-run-btn:hover {
      opacity: 0.9;
    }
    .tp-status {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 500;
      padding: 6px 0;
    }
    .tp-status.tp-ok {
      color: var(--green, #16a34a);
    }
    .tp-status.tp-fail {
      color: var(--red, #ef4444);
    }
    .tp-spinner {
      display: inline-block;
      animation: tp-spin 1s linear infinite;
    }
    @keyframes tp-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .tp-icon {
      font-size: 16px;
    }
    .tp-elapsed {
      font-size: 12px;
      color: var(--text2);
    }
    .tp-steps {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .tp-step {
      border: 1px solid var(--border-subtle, var(--border));
      border-radius: var(--radius, 6px);
      overflow: hidden;
    }
    .tp-step-fail {
      border-color: var(--red, #ef4444);
    }
    .tp-step-head {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 10px;
      cursor: pointer;
      font-size: 12px;
      font-family: var(--font-mono, monospace);
      user-select: none;
    }
    .tp-step-head:hover {
      background: var(--bg3, rgba(0,0,0,0.03));
    }
    .tp-step-icon {
      font-size: 13px;
      flex-shrink: 0;
    }
    .tp-step-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tp-step-toggle {
      font-size: 10px;
      color: var(--text3);
      flex-shrink: 0;
    }
    .tp-step-payload {
      margin: 0;
      padding: 8px 10px;
      border-top: 1px solid var(--border-subtle, var(--border));
      background: var(--bg-background, var(--bg));
      font-family: var(--font-mono, monospace);
      font-size: 11px;
      color: var(--text-primary);
      white-space: pre-wrap;
      overflow-x: auto;
      max-height: 200px;
      overflow-y: auto;
    }
    .tp-empty {
      font-size: 12px;
      color: var(--text3);
      text-align: center;
      padding: 12px 0;
    }
    .tp-inputs {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 8px;
    }
    .tp-inputs-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--text2);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding-bottom: 4px;
    }
    .tp-input-field {
      width: 100%;
    }
    .tp-input-field ::ng-deep .mdc-text-field--outlined {
      font-size: 13px;
    }
  `,
})
export class WorkflowTestPanelComponent implements OnChanges {
  private readonly api = inject(WorkflowApiService);

  @Input({ required: true }) workflowId!: string;
  @Input() workflowActions: unknown[] = [];
  @Output() close = new EventEmitter<void>();

  readonly executionId = signal<string | null>(null);
  readonly runId = signal<string | null>(null);
  readonly status = signal<"idle" | "running" | "completed" | "failed">("idle");
  readonly detail = signal<IWorkflowExecutionDetail | null>(null);
  readonly steps = signal<ITestStep[]>([]);
  readonly elapsed = signal<string>("");
  readonly requestVars = signal<string[]>([]);
  readonly requestValues = signal<Record<string, string>>({});

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["workflowActions"]) {
      this.extractRequestVars();
    }
  }

  onRequestVarChange(key: string, value: string): void {
    this.requestValues.update((vals) => ({ ...vals, [key]: value }));
  }

  private extractRequestVars(): void {
    const vars = new Set<string>();
    const json = JSON.stringify(this.workflowActions);
    const regex = /\{\{request\.([^}]+)\}\}/g;
    let match;
    while ((match = regex.exec(json)) !== null) {
      vars.add(match[1]);
    }
    const sorted = [...vars].sort();
    this.requestVars.set(sorted);
    const values: Record<string, string> = {};
    const prev = this.requestValues();
    for (const v of sorted) {
      values[v] = prev[v] ?? "";
    }
    this.requestValues.set(values);
  }

  async run(): Promise<void> {
    this.status.set("running");
    this.startedAt = Date.now();
    this.elapsed.update(() => this.formatElapsed(0));
    this.startElapsedTimer();

    try {
      const request: Record<string, string> = {};
      for (const [key, value] of Object.entries(this.requestValues())) {
        if (value.trim()) {
          request[key] = value.trim();
        }
      }

      const result = await firstValueFrom(
        this.api.execute(this.workflowId, {
          agentTimeoutSec: 900,
          request,
        })
      );
      this.executionId.set(result.executionId);
      this.runId.set(result.runId);
      this.startPolling(result.executionId);
    } catch (err) {
      this.status.set("failed");
      this.steps.set([
        {
          name: "execute",
          kind: "fail",
          payload: String(err ?? "Unknown error"),
          expanded: true,
        },
      ]);
    }
  }

  rerun(): void {
    this.stopPolling();
    this.steps.set([]);
    this.detail.set(null);
    this.executionId.set(null);
    this.runId.set(null);
    this.elapsed.set("");
    this.startedAt = 0;
    void this.run();
  }

  closePanel(): void {
    this.stopPolling();
    this.close.emit();
  }

  toggleStep(index: number): void {
    this.steps.update((list) =>
      list.map((s, i) => (i === index ? { ...s, expanded: !s.expanded } : s))
    );
  }

  // ── Private ──────────────────────────────────────

  private startPolling(executionId: string): void {
    this.pollTimer = setInterval(() => {
      this.api.getExecutionDetail(this.workflowId, executionId).subscribe({
        next: (detail) => {
          this.detail.set(detail);
          this.extractSteps(detail);
          const normalizedStatus = detail.status?.toLowerCase();
          if (
            normalizedStatus === "completed" ||
            normalizedStatus === "failed"
          ) {
            this.status.set(
              normalizedStatus === "completed" ? "completed" : "failed"
            );
            this.stopPolling();
            this.stopElapsedTimer();
            this.elapsed.update(() =>
              this.formatElapsed(Date.now() - this.startedAt)
            );
          }
        },
        error: () => {
          // Silently retry on next poll tick
        },
      });
    }, 2000);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private elapsedTimer: ReturnType<typeof setInterval> | null = null;

  private startElapsedTimer(): void {
    this.elapsedTimer = setInterval(() => {
      const diff = Date.now() - this.startedAt;
      this.elapsed.update(() => this.formatElapsed(diff));
    }, 1000);
  }

  private stopElapsedTimer(): void {
    if (this.elapsedTimer !== null) {
      clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
  }

  private formatElapsed(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  private extractSteps(detail: IWorkflowExecutionDetail): void {
    const out: ITestStep[] = [];
    const results = (detail.result?.results ?? {}) as Record<string, unknown>;
    const failedActivity = detail.failure?.activityName ?? null;
    const isFail = (detail.failure ?? null) !== null;

    for (const [name, payload] of Object.entries(results)) {
      out.push({
        name,
        kind: "ok",
        payload: stringifyPayload(payload),
        expanded: false,
      });
    }

    if (failedActivity && !out.some((s) => s.name === failedActivity)) {
      out.push({
        name: failedActivity,
        kind: "fail",
        payload: detail.failure?.cause ?? detail.failure?.message ?? null,
        expanded: true,
      });
    } else if (failedActivity) {
      const idx = out.findIndex((s) => s.name === failedActivity);
      if (idx !== -1) {
        out[idx] = { ...out[idx]!, kind: "fail", expanded: true };
      }
    }

    if (out.length === 0 && isFail && detail.failure) {
      out.push({
        name: detail.failure.activityName ?? "execution",
        kind: "fail",
        payload: detail.failure.cause ?? detail.failure.message,
        expanded: true,
      });
    }

    if (isFail && out.length === 0) {
      // No results and no known failure step — mark as failed with generic
      out.push({
        name: "execution",
        kind: "fail",
        payload: detail.failure?.message ?? "Unknown error",
        expanded: true,
      });
    }

    this.steps.set(out);

    // Also reflect final status from the detail
    const normalizedStatus = detail.status?.toLowerCase();
    if (normalizedStatus === "completed" || normalizedStatus === "failed") {
      this.status.set(
        normalizedStatus === "completed" ? "completed" : "failed"
      );
    }
  }
}
