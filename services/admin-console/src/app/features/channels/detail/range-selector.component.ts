import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Output,
  input,
} from "@angular/core";

export type UsageRange = "1h" | "6h" | "24h" | "7d" | "30d";

const RANGES: ReadonlyArray<{ readonly id: UsageRange; readonly label: string }> = [
  { id: "1h", label: "1h" },
  { id: "6h", label: "6h" },
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
];

@Component({
  selector: "app-range-selector",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="range-selector" role="tablist" aria-label="Time range">
      @for (r of ranges; track r.id) {
        <button
          type="button"
          role="tab"
          class="range-btn"
          [class.is-active]="r.id === value()"
          [attr.aria-selected]="r.id === value()"
          (click)="select(r.id)"
        >
          {{ r.label }}
        </button>
      }
    </div>
  `,
  styles: `
    .range-selector {
      display: inline-flex;
      gap: 4px;
      padding: 4px;
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 8px;
    }
    .range-btn {
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text3);
      background: transparent;
      border: 0;
      border-radius: 6px;
      cursor: pointer;
      transition: color .15s, background .15s;
    }
    .range-btn:hover {
      color: var(--text);
    }
    .range-btn.is-active {
      background: var(--bg);
      color: var(--text);
      box-shadow: inset 0 0 0 1px var(--border);
    }
  `,
})
export class RangeSelectorComponent {
  readonly value = input<UsageRange>("24h");
  @Output() readonly valueChange = new EventEmitter<UsageRange>();

  readonly ranges = RANGES;

  select(next: UsageRange): void {
    if (next !== this.value()) this.valueChange.emit(next);
  }
}
