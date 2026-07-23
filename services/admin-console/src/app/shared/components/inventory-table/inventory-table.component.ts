import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from "@angular/core";
import { SparklineComponent } from "../sparkline/sparkline.component";
import {
  HealthStatus,
  StatusBadgeColor,
  StatusBadgeComponent,
  StatusBadgeVariant,
} from "../status-badge/status-badge.component";

/** Base fields shared by every column shape, independent of cell renderer. */
interface IInventoryTableColumnBase {
  /** Unique key, used for @for tracking and as an aria/debug identifier. */
  key: string;
  header: string;
  /** CSS grid track size for this column, e.g. "1.6fr" or "80px". Defaults to "1fr". */
  width?: string;
}

/** Plain text or monospace text cell. */
export interface IInventoryTableTextColumn<T>
  extends IInventoryTableColumnBase {
  type: "text" | "mono";
  value: (row: T) => string;
}

/** Cell rendered via the shared `StatusBadgeComponent`. */
export interface IInventoryTableStatusColumn<T>
  extends IInventoryTableColumnBase {
  type: "status-badge";
  value: (row: T) => string;
  health?: (row: T) => HealthStatus | undefined;
  variant?: StatusBadgeVariant;
  /**
   * Explicit badge color per row, mirroring the sparkline column's
   * per-row `color` accessor below. Forwarded to `StatusBadgeComponent`'s
   * `color` input so `variant: "badge"` consumers (e.g. role chips —
   * T08 finding 5) aren't limited to the health-heuristic default.
   */
  color?: (row: T) => StatusBadgeColor;
}

/** Cell rendered via the shared `SparklineComponent`. */
export interface IInventoryTableSparklineColumn<T>
  extends IInventoryTableColumnBase {
  type: "sparkline";
  value: (row: T) => number[];
  color?: (row: T) => string;
}

/**
 * Strictly typed generic column model. No feature-specific logic lives
 * here — consumers pass accessor functions and this component only
 * renders the shape they describe.
 */
export type InventoryTableColumn<T> =
  | IInventoryTableTextColumn<T>
  | IInventoryTableStatusColumn<T>
  | IInventoryTableSparklineColumn<T>;

/**
 * Generic inventory/fleet table primitive — see the accounts inventory
 * grid in `Rediseño Terminal.dc.html` lines 280-299 (mono uppercase
 * header row, row-hover background, mono cells, chevron affordance is
 * left to the consumer via a trailing column).
 */
@Component({
  selector: "app-inventory-table",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StatusBadgeComponent, SparklineComponent],
  template: `
    <div class="inventory-table" role="table" [attr.aria-label]="ariaLabel()">
      <div
        class="table-header"
        role="row"
        [style.grid-template-columns]="gridTemplate()"
      >
        @for (col of columns(); track col.key) {
          <span class="table-header-cell" role="columnheader">{{
            col.header
          }}</span>
        }
      </div>

      @if (rowsWithEmptyLog().length === 0) {
        <div class="table-empty">{{ emptyMessage() }}</div>
      } @else {
        @for (row of rowsWithEmptyLog(); track $index) {
          <div
            class="table-row"
            role="row"
            tabindex="0"
            [style.grid-template-columns]="gridTemplate()"
            (click)="onRowClick(row)"
            (keydown.enter)="onRowClick(row)"
          >
            @for (col of columns(); track col.key) {
              <span class="table-cell" role="cell">
                @if (isTextColumn(col)) {
                  <span [class.mono]="col.type === 'mono'">{{
                    col.value(row)
                  }}</span>
                } @else if (isStatusColumn(col)) {
                  <app-status-badge
                    [status]="col.value(row)"
                    [variant]="col.variant ?? 'dot'"
                    [health]="col.health ? col.health(row) : undefined"
                    [color]="col.color ? col.color(row) : undefined"
                  />
                } @else if (isSparklineColumn(col)) {
                  <app-sparkline
                    [data]="col.value(row)"
                    [color]="col.color ? col.color(row) : 'var(--rd-accent)'"
                  />
                }
              </span>
            }
          </div>
        }
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      border: 1px solid var(--rd-line);
      border-radius: var(--rd-radius-9, 10px);
      overflow-x: auto;
    }
    .inventory-table {
      min-width: 100%;
      width: max-content;
      display: flex;
      flex-direction: column;
    }
    .table-header {
      display: grid;
      gap: var(--rd-space-6, 12px);
      padding: var(--rd-space-4, 8px) var(--rd-space-10, 20px);
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-2xs, 10px);
      color: var(--rd-text-3);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid var(--rd-line-2);
    }
    .table-row {
      display: grid;
      gap: var(--rd-space-6, 12px);
      padding: var(--rd-space-6, 12px) var(--rd-space-10, 20px);
      font-size: var(--rd-text-size-base, 13px);
      color: var(--rd-text-1);
      border-bottom: 1px solid var(--rd-line-2);
      align-items: center;
      cursor: pointer;
    }
    .table-row:last-child {
      border-bottom: none;
    }
    .table-row:hover,
    .table-row:focus-visible {
      background: var(--rd-panel);
    }
    .table-cell {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .mono {
      font-family: var(--rd-font-mono);
    }
    .table-empty {
      padding: var(--rd-space-11, 24px) var(--rd-space-10, 20px);
      font-size: var(--rd-text-size-base, 13px);
      color: var(--rd-text-3);
      text-align: center;
    }
  `,
})
export class InventoryTableComponent<T> {
  readonly columns = input.required<InventoryTableColumn<T>[]>();
  readonly rows = input<T[]>([]);
  readonly ariaLabel = input<string>("Inventory table");
  readonly emptyMessage = input<string>("No rows to display");

  readonly rowClick = output<T>();

  readonly gridTemplate = computed(() => {
    const cols = this.columns();
    if (cols.length === 0) {
      // Verbose logging: an empty column config renders a headerless,
      // cellless table — must not fail silently.
      console.debug(
        "[InventoryTableComponent] empty column config, table will render without headers or cells"
      );
    }
    return cols.map((col) => col.width ?? "1fr").join(" ");
  });

  readonly rowsWithEmptyLog = computed(() => {
    const data = this.rows();
    if (data.length === 0) {
      // Verbose logging: empty row data must not fail silently.
      console.debug(
        "[InventoryTableComponent] no rows to render, showing empty state",
        { emptyMessage: this.emptyMessage() }
      );
    }
    return data;
  });

  isTextColumn(
    col: InventoryTableColumn<T>
  ): col is IInventoryTableTextColumn<T> {
    return col.type === "text" || col.type === "mono";
  }

  isStatusColumn(
    col: InventoryTableColumn<T>
  ): col is IInventoryTableStatusColumn<T> {
    return col.type === "status-badge";
  }

  isSparklineColumn(
    col: InventoryTableColumn<T>
  ): col is IInventoryTableSparklineColumn<T> {
    return col.type === "sparkline";
  }

  onRowClick(row: T): void {
    if (row === undefined || row === null) {
      // Verbose logging: an undefined/null row must not fail silently.
      console.debug(
        "[InventoryTableComponent] row click ignored, row is nullish"
      );
      return;
    }
    this.rowClick.emit(row);
  }
}
