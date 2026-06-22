import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute, Router } from "@angular/router";
import { UtcDatePipe } from "../../../../shared/pipes/utc-date.pipe";
import {
  type ExecutionSortDirection,
  type IWorkflowExecutionRow,
  WorkflowApiService,
} from "../services/workflow-api.service";

const DEFAULT_PAGE_SIZE = 20;

/**
 * Workflow Executions sub-tab — a full filterable table.
 *
 * Promotes the content of `workflow-executions-dialog` into a routable
 * page (`/workflows/:id/executions`). The dialog stays as a quick-peek
 * on the workflows LIST per Phase 3 design.
 *
 * Server-side pagination + sort, mirroring the dialog's behaviour.
 * Click a row → run detail (`/workflows/:id/runs/:runId`).
 */
@Component({
  selector: "app-workflow-executions",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UtcDatePipe],
  template: `
    <section class="exec">
      <header class="exec-h">
        <div class="exec-filter">
          <label class="exec-filter-l" for="exec-status">Status</label>
          <select
            id="exec-status"
            (change)="onStatusFilter($event)"
            [value]="statusFilter()"
          >
            <option value="">All</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="running">Running</option>
          </select>
        </div>
        <div class="exec-meta">{{ total() }} executions</div>
      </header>

      @if (loading()) {
        <p class="empty">Loading…</p>
      }

      @if (!loading()) {
        <div class="table">
          <div class="row row-head">
            <span class="c-status">Status</span>
            <span class="c-id">ID</span>
            <span class="c-time">Created</span>
            <span class="c-tw">Temporal ID</span>
          </div>
          @for (r of filteredRows(); track r.id) {
            <a class="row" (click)="openRun(r)">
              <span class="c-status" [class]="'rs-' + statusClass(r.status)">
                <span class="dot"></span>{{ r.status }}
              </span>
              <span class="c-id">{{ shortId(r.id) }}</span>
              <span class="c-time">{{ r.createdAt | utcDate: "medium" }}</span>
              <span class="c-tw">{{ r.temporalWorkflowId }}</span>
            </a>
          } @empty {
            <p class="empty">No executions match this filter.</p>
          }
        </div>

        <footer class="pager">
          <button
            class="pg-btn"
            type="button"
            [disabled]="page() === 0"
            (click)="prev()"
          >
            ← Prev
          </button>
          <span class="pg-meta">Page {{ page() + 1 }} · {{ pageSize }}/page</span>
          <button
            class="pg-btn"
            type="button"
            [disabled]="!hasNext()"
            (click)="next()"
          >
            Next →
          </button>
        </footer>
      }
    </section>
  `,
  styles: `
    :host { display: block; }
    .exec {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .exec-h {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 6px 0;
    }
    .exec-filter {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .exec-filter-l {
      font-size: 12px;
      color: var(--text2);
    }
    .exec-filter select {
      font-size: 12px;
      background: var(--bg-surface);
      color: var(--text-primary);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      padding: 4px 8px;
    }
    .exec-meta {
      font-size: 12px;
      color: var(--text3);
    }
    .table {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      overflow: hidden;
    }
    .row {
      display: grid;
      grid-template-columns: 110px 110px 1fr 1fr;
      gap: 12px;
      padding: 8px 14px;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 12px;
      cursor: pointer;
      text-decoration: none;
      color: inherit;
      align-items: center;
    }
    .row:last-child { border-bottom: none; }
    .row.row-head {
      cursor: default;
      background: var(--bg3);
      color: var(--text2);
      font-weight: 500;
    }
    .row:not(.row-head):hover { background: var(--bg3); }
    .c-status {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .c-status .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    .rs-ok { color: var(--green, #16a34a); }
    .rs-fail { color: var(--red, #ef4444); }
    .rs-running { color: var(--primary, #1a66ff); }
    .rs-other { color: var(--text2); }
    .c-id {
      font-family: var(--font-mono, monospace);
      color: var(--text-primary);
    }
    .c-time { color: var(--text2); }
    .c-tw {
      font-family: var(--font-mono, monospace);
      color: var(--text3);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .empty { font-size: 12px; color: var(--text3); padding: 16px; text-align: center; }
    .pager {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      padding: 8px 0;
    }
    .pg-btn {
      font-size: 12px;
      padding: 5px 12px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      background: var(--bg-surface);
      color: var(--text-primary);
      cursor: pointer;
    }
    .pg-btn:hover:not([disabled]) { background: var(--bg3); }
    .pg-btn[disabled] { opacity: 0.5; cursor: not-allowed; }
    .pg-meta { font-size: 12px; color: var(--text3); }
  `,
})
export class WorkflowExecutionsComponent implements OnInit {
  private readonly api = inject(WorkflowApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly pageSize = DEFAULT_PAGE_SIZE;

  // Walk up to the parent's :id param.
  private readonly parentParams = toSignal(
    this.route.parent?.params ?? this.route.params,
    { initialValue: this.route.parent?.snapshot.params ?? {} }
  );
  private readonly id = computed<string>(() => this.parentParams()["id"] ?? "");

  readonly rows = signal<IWorkflowExecutionRow[]>([]);
  readonly total = signal(0);
  readonly loading = signal(true);
  readonly page = signal(0);
  readonly statusFilter = signal<string>("");
  readonly sort = signal<ExecutionSortDirection>("desc");

  readonly hasNext = computed(
    () => (this.page() + 1) * this.pageSize < this.total()
  );

  readonly filteredRows = computed(() => {
    const f = this.statusFilter().toLowerCase();
    if (!f) {
      return this.rows();
    }
    return this.rows().filter((r) => r.status.toLowerCase().includes(f));
  });

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
      .listExecutions(id, {
        page: this.page(),
        pageSize: this.pageSize,
        sort: this.sort(),
      })
      .subscribe({
        next: (resp) => {
          this.rows.set(resp.items);
          this.total.set(resp.total);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  protected onStatusFilter(ev: Event): void {
    const target = ev.target as HTMLSelectElement;
    this.statusFilter.set(target.value);
  }

  protected prev(): void {
    if (this.page() > 0) {
      this.page.update((p) => p - 1);
      this.fetch();
    }
  }

  protected next(): void {
    if (this.hasNext()) {
      this.page.update((p) => p + 1);
      this.fetch();
    }
  }

  protected openRun(r: IWorkflowExecutionRow): void {
    void this.router.navigate(["/workflows", this.id(), "runs", r.id]);
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
}
