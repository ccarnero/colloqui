import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from "@angular/core";

export type UsagePresetRange = "6h" | "24h" | "7d" | "30d";
export type UsageRangeMode = "preset" | "custom";

export interface IUsageRangeSelection {
  readonly mode: UsageRangeMode;
  readonly preset?: UsagePresetRange;
  readonly from?: string;
  readonly to?: string;
}

const RANGES: ReadonlyArray<{
  readonly id: UsagePresetRange;
  readonly label: string;
}> = [
  { id: "6h", label: "6h" },
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
];

const DEFAULT_CUSTOM_RANGE_MS = 24 * 60 * 60 * 1000;

function toDateTimeLocalValue(date: Date): string {
  const localMs = date.getTime() - date.getTimezoneOffset() * 60_000;
  return new Date(localMs).toISOString().slice(0, 16);
}

function isoToDateTimeLocalValue(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : toDateTimeLocalValue(date);
}

function dateTimeLocalValueToIso(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

@Component({
  selector: "app-range-selector",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="range-control">
      <div class="range-selector" role="tablist" aria-label="Time range">
        @for (r of ranges; track r.id) {
          <button
            type="button"
            role="tab"
            class="range-btn"
            [class.is-active]="isPresetActive(r.id)"
            [attr.aria-selected]="isPresetActive(r.id)"
            (click)="selectPreset(r.id)"
          >
            {{ r.label }}
          </button>
        }
        <button
          type="button"
          role="tab"
          class="range-btn"
          [class.is-active]="isCustomActive()"
          [attr.aria-selected]="isCustomActive()"
          (click)="selectCustom()"
        >
          Custom
        </button>
      </div>

      @if (isCustomActive()) {
        <div class="custom-range" aria-label="Custom date range">
          <label>
            <span>Start</span>
            <input
              type="datetime-local"
              [value]="customFrom()"
              (input)="onCustomFromInput($event)"
            />
          </label>
          <label>
            <span>End</span>
            <input
              type="datetime-local"
              [value]="customTo()"
              (input)="onCustomToInput($event)"
            />
          </label>
          <button
            type="button"
            class="range-btn apply-btn"
            [disabled]="!canApplyCustom()"
            (click)="applyCustom()"
          >
            Apply
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .range-control {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
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
    .range-btn:disabled {
      cursor: not-allowed;
      opacity: .5;
    }
    .custom-range {
      display: inline-flex;
      align-items: end;
      gap: 8px;
      padding: 4px;
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 8px;
    }
    .custom-range label {
      display: grid;
      gap: 2px;
      font-size: 11px;
      color: var(--text3);
    }
    .custom-range input {
      height: 28px;
      color: var(--text);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0 8px;
      font-size: 12px;
    }
    .apply-btn {
      background: var(--bg);
      border: 1px solid var(--border);
    }
  `,
})
export class RangeSelectorComponent {
  readonly value = input<IUsageRangeSelection>({
    mode: "preset",
    preset: "24h",
  });
  readonly valueChange = output<IUsageRangeSelection>();

  readonly ranges = RANGES;
  readonly customFrom = signal<string>("");
  readonly customTo = signal<string>("");
  private readonly editingCustom = signal<boolean>(false);

  readonly isCustomActive = computed<boolean>(
    () => this.editingCustom() || this.value().mode === "custom",
  );
  readonly canApplyCustom = computed<boolean>(
    () => this.customFrom().length > 0 && this.customTo().length > 0,
  );

  isPresetActive(id: UsagePresetRange): boolean {
    const current = this.value();
    return !this.editingCustom() && current.mode === "preset" && current.preset === id;
  }

  selectPreset(next: UsagePresetRange): void {
    this.editingCustom.set(false);
    const current = this.value();
    if (current.mode === "preset" && current.preset === next) return;
    this.valueChange.emit({ mode: "preset", preset: next });
  }

  selectCustom(): void {
    this.editingCustom.set(true);
    const current = this.value();
    if (current.mode === "custom") {
      this.customFrom.set(isoToDateTimeLocalValue(current.from));
      this.customTo.set(isoToDateTimeLocalValue(current.to));
      return;
    }
    if (this.customFrom() && this.customTo()) return;
    const now = new Date();
    this.customFrom.set(
      toDateTimeLocalValue(new Date(now.getTime() - DEFAULT_CUSTOM_RANGE_MS)),
    );
    this.customTo.set(toDateTimeLocalValue(now));
  }

  onCustomFromInput(event: Event): void {
    this.customFrom.set((event.target as HTMLInputElement).value);
  }

  onCustomToInput(event: Event): void {
    this.customTo.set((event.target as HTMLInputElement).value);
  }

  applyCustom(): void {
    const from = dateTimeLocalValueToIso(this.customFrom());
    const to = dateTimeLocalValueToIso(this.customTo());
    if (!from || !to) return;
    this.editingCustom.set(false);
    this.valueChange.emit({ mode: "custom", from, to });
  }
}
