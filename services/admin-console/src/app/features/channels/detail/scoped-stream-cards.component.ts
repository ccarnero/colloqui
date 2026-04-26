import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Output,
  computed,
  input,
} from "@angular/core";
import { DatePipe, DecimalPipe, UpperCasePipe } from "@angular/common";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import type {
  IUsageTotalsRow,
  UsageDirection,
} from "../../../core/models/channel-streams.model";

interface IScopedStreamRow {
  readonly direction: UsageDirection;
  readonly label: string;
  readonly streamKey: "ingress" | "dlq";
  readonly events: number;
  readonly firstTs: string | null;
  readonly lastTs: string | null;
}

const DIRECTION_ORDER: ReadonlyArray<UsageDirection> = [
  "ingress",
  "egress",
  "dlq",
];

const DIRECTION_META: ReadonlyMap<
  UsageDirection,
  { readonly label: string; readonly streamKey: "ingress" | "dlq" }
> = new Map([
  ["ingress", { label: "Ingress", streamKey: "ingress" }],
  ["egress", { label: "Egress", streamKey: "ingress" }],
  ["dlq", { label: "DLQ", streamKey: "dlq" }],
]);

@Component({
  selector: "app-scoped-stream-cards",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    DecimalPipe,
    UpperCasePipe,
    MatButtonModule,
    MatIconModule,
  ],
  template: `
    <div class="stream-grid">
      @for (row of rows(); track row.direction) {
        <div class="stream-card">
          <div class="stream-card__header">
            <div class="stream-card__title">
              <span
                class="badge"
                [class.badge-blue]="row.streamKey === 'ingress'"
                [class.badge-red]="row.streamKey === 'dlq'"
              >
                {{ row.direction | uppercase }}
              </span>
              <strong>{{ row.label }}</strong>
              <span class="hint">({{ row.streamKey | uppercase }} stream)</span>
            </div>
            <button
              mat-stroked-button
              type="button"
              color="primary"
              (click)="inspect.emit(row.streamKey)"
            >
              <mat-icon>search</mat-icon>
              Inspect
            </button>
          </div>

          <div class="stream-card__stats">
            <div class="stat">
              <div class="stat-label">Events (range)</div>
              <div class="stat-value">{{ row.events | number }}</div>
            </div>
            <div class="stat">
              <div class="stat-label">First event</div>
              <div class="stat-value small">
                @if (row.firstTs) {
                  {{ row.firstTs | date: "medium" }}
                } @else {
                  —
                }
              </div>
            </div>
            <div class="stat">
              <div class="stat-label">Last event</div>
              <div class="stat-value small">
                @if (row.lastTs) {
                  {{ row.lastTs | date: "medium" }}
                } @else {
                  —
                }
              </div>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .stream-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px;
    }
    .stream-card {
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .stream-card__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .stream-card__title {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      color: var(--text);
    }
    .hint {
      font-size: 11px;
      color: var(--text3);
      font-family: monospace;
    }
    .stream-card__stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }
    .stat-label {
      font-size: 11px;
      color: var(--text3);
      text-transform: uppercase;
      letter-spacing: .04em;
    }
    .stat-value {
      font-size: 18px;
      font-weight: 700;
      color: var(--text);
      margin-top: 2px;
    }
    .stat-value.small {
      font-size: 13px;
      font-weight: 500;
    }
    .badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
    }
    .badge-blue {
      background: rgba(79, 126, 248, 0.15);
      color: #4f7ef8;
    }
    .badge-red {
      background: rgba(239, 68, 68, 0.15);
      color: #ef4444;
    }
  `,
})
export class ScopedStreamCardsComponent {
  readonly totals = input<ReadonlyArray<IUsageTotalsRow>>([]);
  @Output() readonly inspect = new EventEmitter<"ingress" | "dlq">();

  readonly rows = computed<ReadonlyArray<IScopedStreamRow>>(() => {
    const byDir = new Map<UsageDirection, IUsageTotalsRow>();
    for (const t of this.totals()) {
      byDir.set(t.direction, t);
    }
    const out: IScopedStreamRow[] = [];
    for (let i = 0; i < DIRECTION_ORDER.length; i++) {
      const direction = DIRECTION_ORDER[i]!;
      const meta = DIRECTION_META.get(direction)!;
      const row = byDir.get(direction);
      out.push({
        direction,
        label: meta.label,
        streamKey: meta.streamKey,
        events: row?.events ?? 0,
        firstTs: row?.firstTs ?? null,
        lastTs: row?.lastTs ?? null,
      });
    }
    return out;
  });
}
