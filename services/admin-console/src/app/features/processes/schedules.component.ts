import { DatePipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  type OnInit,
} from "@angular/core";
import { PageHeaderComponent } from "../../shared/components/page-header/page-header.component";
import {
  SchedulesService,
  type ISchedule,
  type ScheduleType,
} from "../../core/services/schedules.service";

const PAGE_SIZE = 20;

/**
 * Schedules — replaces the old static /scheduler page.
 *
 * Backed by scheduler-service:
 *   GET    /scheduler/schedules
 *   POST   /scheduler/schedules/:id/trigger
 *   PATCH  /scheduler/schedules/:id { enabled }
 *   DELETE /scheduler/schedules/:id
 *
 * Phase 4 ships list + status + trigger + enable/disable. Creation
 * and editing of schedules (cron expressions, exec mode, env vars) are
 * deferred — they need a richer form than fits this pass.
 */
@Component({
  selector: "app-schedules",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, PageHeaderComponent],
  template: `
    <app-page-header
      title="Schedules"
      subtitle="Tareas programadas (cron, interval, one-time)"
    >
      <div slot="actions">
        <button class="btn" type="button" (click)="reload()">Refresh</button>
        <button class="btn" type="button" disabled title="Coming soon">+ New schedule</button>
      </div>
    </app-page-header>

    <div class="filters">
      <select [value]="typeFilter() ?? ''" (change)="onTypeChange($event)">
        <option value="">All types</option>
        <option value="cron">cron</option>
        <option value="interval">interval</option>
        <option value="one-time">one-time</option>
      </select>
      <select [value]="enabledFilter()" (change)="onEnabledChange($event)">
        <option value="">All</option>
        <option value="true">Enabled</option>
        <option value="false">Disabled</option>
      </select>
      <span class="meta">{{ total() }} schedules</span>
    </div>

    @if (loading()) {
      <p class="empty">Loading…</p>
    }

    @if (!loading()) {
      <div class="panel">
        <div class="row row-head">
          <span class="c-en">Enabled</span>
          <span class="c-name">Name</span>
          <span class="c-type">Type</span>
          <span class="c-spec">Spec</span>
          <span class="c-next">Next run</span>
          <span class="c-actions">Actions</span>
        </div>
        @for (s of rows(); track s.id) {
          <div class="row">
            <span class="c-en">
              <span
                class="dot"
                [class]="s.enabled ? 'dot-on' : 'dot-off'"
                [title]="s.enabled ? 'Enabled' : 'Disabled'"
              ></span>
            </span>
            <span class="c-name">
              <span class="nm">{{ s.name }}</span>
              @if (s.description) {
                <span class="desc">{{ s.description }}</span>
              }
            </span>
            <span class="c-type">{{ s.type }}</span>
            <span class="c-spec">{{ specOf(s) }}</span>
            <span class="c-next">
              @if (s.nextRunAt) {
                {{ s.nextRunAt | date: "short" }}
              } @else {
                —
              }
            </span>
            <span class="c-actions">
              <button
                class="btn-mini"
                type="button"
                (click)="trigger(s)"
                [disabled]="busy() === s.id"
              >Run</button>
              <button
                class="btn-mini"
                type="button"
                (click)="toggle(s)"
                [disabled]="busy() === s.id"
              >{{ s.enabled ? 'Disable' : 'Enable' }}</button>
            </span>
          </div>
        } @empty {
          <p class="empty">No schedules match this filter.</p>
        }
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .filters {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 0 0;
    }
    .filters select {
      font-size: 12px;
      background: var(--bg-surface);
      color: var(--text-primary);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      padding: 4px 8px;
    }
    .filters .meta {
      margin-left: auto;
      font-size: 12px;
      color: var(--text3);
    }
    .panel {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      overflow: hidden;
      margin-top: 12px;
    }
    .row {
      display: grid;
      grid-template-columns: 70px 1.4fr 90px 1fr 120px 140px;
      gap: 12px;
      padding: 9px 14px;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 12px;
      align-items: center;
    }
    .row:last-child { border-bottom: none; }
    .row.row-head {
      background: var(--bg3);
      color: var(--text2);
      font-weight: 500;
    }
    .c-en { display: inline-flex; align-items: center; }
    .dot {
      width: 8px; height: 8px; border-radius: 50%;
    }
    .dot-on { background: var(--green, #16a34a); }
    .dot-off { background: var(--text3); }
    .c-name { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .nm { color: var(--text-primary); font-weight: 500; }
    .desc { color: var(--text2); font-size: 11px; }
    .c-type { color: var(--text2); font-family: var(--font-mono, monospace); }
    .c-spec { color: var(--text-primary); font-family: var(--font-mono, monospace); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .c-next { color: var(--text2); }
    .c-actions { display: flex; gap: 6px; }
    .btn-mini {
      font-size: 11px;
      padding: 3px 8px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      background: var(--bg-surface);
      color: var(--text-primary);
      cursor: pointer;
    }
    .btn-mini[disabled] { opacity: 0.5; cursor: not-allowed; }
    .btn {
      font-size: 12px;
      padding: 6px 12px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      background: var(--bg-surface);
      color: var(--text-primary);
      cursor: pointer;
    }
    .btn[disabled] { opacity: 0.5; cursor: not-allowed; }
    .empty { padding: 20px; text-align: center; color: var(--text3); font-size: 12px; }
  `,
})
export class SchedulesComponent implements OnInit {
  private readonly api = inject(SchedulesService);

  readonly rows = signal<ISchedule[]>([]);
  readonly total = signal(0);
  readonly loading = signal(true);
  readonly busy = signal<string | null>(null);
  readonly typeFilter = signal<ScheduleType | null>(null);
  readonly enabledFilter = signal<string>("");

  ngOnInit(): void {
    this.reload();
  }

  protected reload(): void {
    this.loading.set(true);
    const enabled =
      this.enabledFilter() === ""
        ? undefined
        : this.enabledFilter() === "true";
    this.api
      .list({
        type: this.typeFilter() ?? undefined,
        enabled,
        limit: PAGE_SIZE,
        offset: 0,
      })
      .subscribe({
        next: (resp) => {
          this.rows.set(resp.items ?? []);
          this.total.set(resp.total ?? (resp.items?.length ?? 0));
          this.loading.set(false);
        },
        error: () => {
          this.rows.set([]);
          this.loading.set(false);
        },
      });
  }

  protected onTypeChange(ev: Event): void {
    const v = (ev.target as HTMLSelectElement).value as ScheduleType | "";
    this.typeFilter.set(v === "" ? null : v);
    this.reload();
  }

  protected onEnabledChange(ev: Event): void {
    this.enabledFilter.set((ev.target as HTMLSelectElement).value);
    this.reload();
  }

  protected trigger(s: ISchedule): void {
    this.busy.set(s.id);
    this.api.trigger(s.id).subscribe({
      next: () => this.busy.set(null),
      error: () => this.busy.set(null),
    });
  }

  protected toggle(s: ISchedule): void {
    this.busy.set(s.id);
    this.api.setEnabled(s.id, !s.enabled).subscribe({
      next: () => {
        this.busy.set(null);
        this.reload();
      },
      error: () => this.busy.set(null),
    });
  }

  protected specOf(s: ISchedule): string {
    if (s.type === "cron") return s.cronExpression ?? "";
    if (s.type === "interval") return `${s.intervalSeconds ?? 0}s`;
    if (s.type === "one-time") return s.oneTimeAt ?? "";
    return "";
  }
}
