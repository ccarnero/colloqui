import { JsonPipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute } from "@angular/router";
import type { IJobExecution } from "../../../../core/models/scheduler.model";
import { SchedulerApiService } from "../../../../core/services/scheduler-api.service";
import { StatusBadgeComponent } from "../../../../shared/components/status-badge/status-badge.component";
import { UtcDatePipe } from "../../../../shared/pipes/utc-date.pipe";

/**
 * Executions list tab for a schedule.
 * Fetches executions for the current job and displays them as cards.
 */
@Component({
  selector: "app-schedule-executions",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UtcDatePipe, JsonPipe, StatusBadgeComponent],
  template: `
    @if (loading()) {
      <div class="loading">Loading executions...</div>
    }

    @if (!loading() && executions().length === 0) {
      <div class="empty">No executions found.</div>
    }

    @if (!loading() && executions().length > 0) {
      <div class="executions-list">
        @for (e of executions(); track e.id) {
          <div
            class="execution-card"
            [class.expanded]="expandedId() === e.id"
            (click)="toggleExpand(e.id)"
          >
            <div class="execution-header">
              <app-status-badge [status]="e.status" />
              <span class="execution-time">
                {{ e.started_at | utcDate:'medium' }}
              </span>
              <span class="execution-duration">
                {{ formatDuration(e.started_at, e.finished_at) }}
              </span>
              <span class="execution-trigger">
                {{ e.triggered_by ?? 'system' }}
              </span>
              <button
                class="expand-btn"
                type="button"
                [class.expanded]="expandedId() === e.id"
              >
                {{ expandedId() === e.id ? '▲' : '▼' }}
              </button>
            </div>

            @if (expandedId() === e.id) {
              <div class="execution-detail">
                @if (e.error_message) {
                  <div class="detail-section">
                    <div class="detail-label">Error</div>
                    <pre class="detail-error">{{ e.error_message }}</pre>
                  </div>
                }

                <div class="detail-section">
                  <div class="detail-label">ID</div>
                  <code>{{ e.id }}</code>
                </div>

                @if (e.finished_at) {
                  <div class="detail-section">
                    <div class="detail-label">Finished</div>
                    <span>{{ e.finished_at | utcDate:'medium' }}</span>
                  </div>
                }

                @if (hasResult(e)) {
                  <div class="detail-section">
                    <div class="detail-label">Result</div>
                    <pre class="detail-json">{{ e.result | json }}</pre>
                  </div>
                }

                @if (e.logs && e.logs.length > 0) {
                  <div class="detail-section">
                    <div class="detail-label">Logs ({{ e.logs.length }})</div>
                    <div class="detail-logs">
                      @for (log of e.logs; track $index) {
                        <pre class="log-line">{{ log }}</pre>
                      }
                    </div>
                  </div>
                }
              </div>
            }
          </div>
        }
      </div>

      <div class="pagination">
        <button
          class="btn"
          type="button"
          [disabled]="offset() === 0"
          (click)="prev()"
        >
          Previous
        </button>
        <span class="pg-meta">{{ offset() + 1 }}–{{ offset() + executions().length }} / {{ total() }}</span>
        <button
          class="btn"
          type="button"
          [disabled]="offset() + limit >= total()"
          (click)="next()"
        >
          Next
        </button>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .loading, .empty {
      font-size: 13px;
      color: var(--text3);
      padding: 24px 0;
      text-align: center;
    }
    .executions-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .execution-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      cursor: pointer;
      transition: border-color 0.12s;
    }
    .execution-card:hover {
      border-color: var(--accent, #4f7ef8);
    }
    .execution-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      font-size: 13px;
    }
    .execution-time {
      color: var(--text-primary);
      min-width: 160px;
    }
    .execution-duration {
      color: var(--text2);
      font-size: 12px;
      min-width: 60px;
    }
    .execution-trigger {
      color: var(--text3);
      font-size: 12px;
      flex: 1;
      text-align: right;
    }
    .expand-btn {
      background: none;
      border: none;
      color: var(--text3);
      cursor: pointer;
      padding: 2px 6px;
      font-size: 11px;
    }
    .expand-btn:hover {
      color: var(--text-primary);
    }
    .execution-detail {
      border-top: 1px solid var(--border-subtle);
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .detail-section {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .detail-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      color: var(--text2);
    }
    .detail-error {
      margin: 0;
      font-size: 12px;
      color: var(--red, #ef4444);
      background: color-mix(in srgb, var(--red, #ef4444) 8%, transparent);
      padding: 8px;
      border-radius: 4px;
      line-height: 1.4;
    }
    .detail-json {
      margin: 0;
      font-size: 12px;
      background: var(--bg2);
      padding: 8px;
      border-radius: 4px;
      overflow-x: auto;
      line-height: 1.4;
    }
    .detail-logs {
      max-height: 200px;
      overflow-y: auto;
      background: var(--bg2);
      border-radius: 4px;
      padding: 8px;
    }
    .log-line {
      margin: 0;
      font-size: 11px;
      line-height: 1.5;
      color: var(--text2);
      white-space: pre-wrap;
      word-break: break-all;
    }
    code {
      font-size: 12px;
      color: var(--accent, #4f7ef8);
    }
    .pagination {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-top: 16px;
    }
    .btn {
      font-size: 12px;
      padding: 6px 12px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      background: var(--bg-surface);
      color: var(--text-primary);
      cursor: pointer;
    }
    .btn:hover:not(:disabled) { background: var(--bg3); }
    .btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .pg-meta {
      font-size: 12px;
      color: var(--text3);
    }
  `,
})
export class ScheduleExecutionsComponent implements OnInit {
  private readonly api = inject(SchedulerApiService);
  private readonly route = inject(ActivatedRoute);

  protected readonly limit = 20;

  // Walk up to the parent's :id param.
  private readonly parentParams = toSignal(
    this.route.parent?.params ?? this.route.params,
    { initialValue: this.route.parent?.snapshot.params ?? {} }
  );
  private readonly id = computed<string>(() => this.parentParams()["id"] ?? "");

  readonly executions = signal<IJobExecution[]>([]);
  readonly total = signal(0);
  readonly loading = signal(true);
  readonly offset = signal(0);
  readonly expandedId = signal<string | null>(null);

  ngOnInit(): void {
    this.fetch();
  }

  private fetch(): void {
    const id = this.id();
    if (!id) {
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.api
      .listExecutions({
        job_id: id,
        limit: this.limit,
        offset: this.offset(),
      })
      .subscribe({
        next: (resp) => {
          this.executions.set(resp.executions);
          this.total.set(resp.total);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  protected formatDuration(
    startedAt: string | null,
    finishedAt: string | null
  ): string {
    if (!startedAt) {
      return "—";
    }
    const start = new Date(startedAt).getTime();
    if (!finishedAt) {
      return "running…";
    }
    const end = new Date(finishedAt).getTime();
    const ms = end - start;
    if (ms < 1000) {
      return `${ms}ms`;
    }
    if (ms < 60000) {
      return `${Math.round(ms / 1000)}s`;
    }
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  }

  protected hasResult(e: IJobExecution): boolean {
    return !!e.result && Object.keys(e.result).length > 0;
  }

  protected toggleExpand(id: string): void {
    this.expandedId.update((current) => (current === id ? null : id));
  }

  protected prev(): void {
    if (this.offset() > 0) {
      this.offset.update((o) => Math.max(0, o - this.limit));
      this.expandedId.set(null);
      this.fetch();
    }
  }

  protected next(): void {
    if (this.offset() + this.limit < this.total()) {
      this.offset.update((o) => o + this.limit);
      this.expandedId.set(null);
      this.fetch();
    }
  }
}
