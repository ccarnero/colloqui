import {
  ChangeDetectionStrategy,
  Component,
  input,
} from "@angular/core";

/**
 * Page header used at the top of every section landing and detail page.
 * Pure presentational shell — breadcrumbs go above (a separate slot
 * provided by the page); status pill and actions are projected children.
 *
 * Example usage:
 *   <app-page-header title="lead-qualification" subtitle="Active workflow">
 *     <ng-container slot="status">...status pill...</ng-container>
 *     <ng-container slot="actions">...buttons...</ng-container>
 *   </app-page-header>
 */
@Component({
  selector: "app-page-header",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  template: `
    <header class="page-header">
      <div class="page-header-text">
        <h1 class="page-title">
          {{ title() }}
          <ng-content select="[slot=status]" />
        </h1>
        @if (subtitle()) {
          <p class="page-subtitle">{{ subtitle() }}</p>
        }
      </div>
      <div class="page-actions">
        <ng-content select="[slot=actions]" />
      </div>
    </header>
  `,
  styles: `
    :host {
      display: block;
    }
    .page-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 20px;
    }
    .page-header-text {
      min-width: 0;
    }
    .page-title {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.3px;
      margin: 0;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .page-subtitle {
      font-size: 13px;
      color: var(--text3);
      margin-top: 2px;
    }
    .page-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-shrink: 0;
    }
  `,
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string | undefined>(undefined);
}
