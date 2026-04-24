import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";
import { DecimalPipe } from "@angular/common";
import type {
  IUsageTotalsRow,
  UsageDirection,
} from "../../../core/models/channel-streams.model";

interface IKpiCard {
  readonly id: UsageDirection;
  readonly label: string;
  readonly value: number;
  readonly color: string;
}

const DIRECTIONS: ReadonlyArray<
  Omit<IKpiCard, "value"> & { readonly id: UsageDirection }
> = [
  { id: "ingress", label: "Ingress", color: "#4f7ef8" },
  { id: "egress", label: "Egress", color: "#22c55e" },
  { id: "dlq", label: "DLQ", color: "#ef4444" },
];

@Component({
  selector: "app-kpi-cards",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    <div class="kpi-grid">
      @for (card of cards(); track card.id) {
        <div class="kpi-card">
          <div class="kpi-label">
            <span class="kpi-dot" [style.background]="card.color"></span>
            {{ card.label }}
          </div>
          <div class="kpi-value">{{ card.value | number }}</div>
        </div>
      }
    </div>
  `,
  styles: `
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
    }
    .kpi-card {
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .kpi-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--text3);
    }
    .kpi-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .kpi-value {
      font-size: 24px;
      font-weight: 700;
      color: var(--text);
      margin-top: 6px;
    }
  `,
})
export class KpiCardsComponent {
  readonly totals = input<ReadonlyArray<IUsageTotalsRow>>([]);

  readonly cards = computed<ReadonlyArray<IKpiCard>>(() => {
    const map = new Map<UsageDirection, number>();
    for (const t of this.totals()) {
      map.set(t.direction, (map.get(t.direction) ?? 0) + t.events);
    }
    return DIRECTIONS.map((d) => ({
      id: d.id,
      label: d.label,
      color: d.color,
      value: map.get(d.id) ?? 0,
    }));
  });
}
