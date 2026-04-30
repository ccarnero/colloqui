/**
 * Angular standalone component skeleton — admin-console conventions.
 *
 * Copy this when starting a new page or shared component. Always:
 *   - standalone: true
 *   - changeDetection: OnPush
 *   - signals + input() for state
 *   - inline template + styles (avoid separate .html/.scss files for
 *     small components; split only when the file exceeds ~250 lines)
 *   - reference CSS variables, never hex literals
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from "@angular/core";
import { Router } from "@angular/router";

/**
 * Inputs are explicit, doc-commented, and prefer `input.required<T>()`
 * over `@Input` decorators.
 */
export interface IComponentNameVm {
  id: string;
  label: string;
  status: "ok" | "fail" | "warn";
}

@Component({
  selector: "app-component-name",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    // Pull primitives from shared/components and core/services as needed.
    // Example:
    //   PageHeaderComponent,
    //   KpiCardComponent,
  ],
  template: `
    <section class="cn">
      <header class="cn-h">
        <div class="cn-h-text">
          <h1 class="cn-title">{{ title() }}</h1>
          @if (subtitle()) {
            <p class="cn-sub">{{ subtitle() }}</p>
          }
        </div>
        <div class="cn-actions">
          <button class="btn btn-primary" type="button" (click)="onPrimary()">
            {{ primaryLabel() }}
          </button>
        </div>
      </header>

      @if (loading()) {
        <p class="empty">Loading…</p>
      }

      @if (!loading()) {
        <div class="panel">
          @for (it of items(); track it.id) {
            <div class="row" [class]="'rs-' + it.status">
              <span class="row-status">
                <span class="dot"></span>{{ it.status }}
              </span>
              <span class="name">{{ it.label }}</span>
            </div>
          } @empty {
            <p class="empty">No items yet.</p>
          }
        </div>
      }
    </section>
  `,
  styles: `
    :host { display: block; }
    .cn { display: flex; flex-direction: column; gap: 12px; }
    .cn-h {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
    }
    .cn-title {
      font-size: 17px;
      font-weight: 500;
      margin: 0;
      color: var(--text-primary);
    }
    .cn-sub {
      font-size: 11px;
      color: var(--text2);
      margin: 4px 0 0;
    }
    .cn-actions { display: flex; gap: 6px; flex-shrink: 0; }
    .btn {
      font-size: 12px;
      padding: 6px 12px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      background: var(--bg-surface);
      color: var(--text-primary);
      cursor: pointer;
    }
    .btn-primary {
      background: var(--primary, #1a66ff);
      color: #fff;
      border-color: var(--primary, #1a66ff);
    }
    .panel {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      overflow: hidden;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 9px 14px;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 12px;
    }
    .row:last-child { border-bottom: none; }
    .row-status { display: inline-flex; align-items: center; gap: 5px; }
    .row-status .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
      opacity: 0.85;
    }
    .rs-ok .row-status { color: var(--green, #16a34a); }
    .rs-fail .row-status { color: var(--red, #ef4444); }
    .rs-warn .row-status { color: var(--yellow, #eab308); }
    .name { flex: 1; color: var(--text-primary); font-weight: 500; }
    .empty {
      padding: 16px;
      text-align: center;
      color: var(--text3);
      font-size: 12px;
    }
  `,
})
export class ComponentNameComponent {
  private readonly router = inject(Router);

  /** Required input — caller must provide. */
  readonly title = input.required<string>();
  /** Optional subtitle. */
  readonly subtitle = input<string | undefined>(undefined);
  /** Primary action label — defaults to a sensible verb. */
  readonly primaryLabel = input<string>("+ New");

  /** Local state lives in signals. */
  readonly items = signal<IComponentNameVm[]>([]);
  readonly loading = signal(true);

  /** Derived state via computed(). */
  readonly errorCount = computed(
    () => this.items().filter((i) => i.status === "fail").length,
  );

  protected onPrimary(): void {
    /* Navigate, dialog, or service call. */
  }
}
