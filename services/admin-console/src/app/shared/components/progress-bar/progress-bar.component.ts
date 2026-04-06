import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";

@Component({
  selector: "app-progress-bar",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  template: `
    @if (isQuotaMode()) {
      <div class="pb-wrap">
        <div class="pb-label-row">
          <span class="pb-label">{{ label() }}</span>
          <span class="pb-values">{{ current() }} / {{ max() }}</span>
        </div>
        <div
          class="pb-track"
          role="progressbar"
          [attr.aria-valuenow]="current()"
          [attr.aria-valuemax]="max()"
        >
          <div
            class="pb-fill"
            [style.width.%]="quotaPercent()"
            [style.background]="color() ?? null"
          ></div>
        </div>
      </div>
    } @else {
      <div
        class="pb-track"
        role="progressbar"
        [attr.aria-valuenow]="clampedValue()"
      >
        <div
          class="pb-fill"
          [style.width.%]="clampedValue()"
          [style.background]="color() ?? null"
        ></div>
      </div>
    }
  `,
  styles: `
    .pb-wrap {
      margin-bottom: 16px;
    }
    .pb-label-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 6px;
      font-size: 12px;
    }
    .pb-label {
      font-weight: 600;
      color: var(--text1, #e5e5e5);
    }
    .pb-values {
      color: var(--text3, #888);
      font-variant-numeric: tabular-nums;
    }
    .pb-track {
      height: 8px;
      background: var(--bg3, #2a2a2a);
      border-radius: 999px;
      overflow: hidden;
      border: 1px solid var(--border, #333);
    }
    .pb-fill {
      height: 100%;
      border-radius: inherit;
      transition: width 0.2s ease;
      background: linear-gradient(
        90deg,
        var(--accent, #6366f1),
        var(--accent2, #22d3ee)
      );
    }
  `,
})
export class ProgressBarComponent {
  /** Simple mode: 0–100 when not using quota inputs. */
  readonly value = input<number>(0);

  /** Optional bar fill (CSS color/gradient); overrides default gradient when set. */
  readonly color = input<string | undefined>(undefined);

  /** Quota mode: row label. */
  readonly label = input<string | undefined>(undefined);

  /** Quota mode: current usage. */
  readonly current = input<number | undefined>(undefined);

  /** Quota mode: limit. */
  readonly max = input<number | undefined>(undefined);

  readonly isQuotaMode = computed(() => {
    const c = this.current();
    const m = this.max();
    return c !== undefined && m !== undefined;
  });

  readonly quotaPercent = computed(() => {
    const m = this.max() ?? 0;
    if (m <= 0) {
      return 0;
    }
    return Math.min(100, Math.round(((this.current() ?? 0) / m) * 100));
  });

  readonly clampedValue = computed(() =>
    Math.min(100, Math.max(0, this.value())),
  );
}
