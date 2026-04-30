import {
  ChangeDetectionStrategy,
  Component,
  input,
} from "@angular/core";
import { RouterLink, RouterLinkActive } from "@angular/router";

export interface ISubTab {
  label: string;
  /** Absolute or relative route (relative requires routerLink to resolve correctly from page context). */
  route: string;
  /** Optional muted count rendered next to the label. */
  count?: number | string;
}

/**
 * Within-page tabs (Overview / Builder / Executions / Settings).
 * Different from the top-level section tabs — these live INSIDE a detail
 * page and route to sibling sub-routes.
 */
@Component({
  selector: "app-sub-tabs",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="sub-tabs" aria-label="Page sections">
      @for (t of tabs(); track t.route) {
        <a
          class="sub-tab"
          [routerLink]="t.route"
          routerLinkActive="active"
          [routerLinkActiveOptions]="{ exact: false }"
        >
          <span class="sub-tab-label">{{ t.label }}</span>
          @if (t.count !== undefined && t.count !== null) {
            <span class="sub-tab-count">{{ t.count }}</span>
          }
        </a>
      }
    </nav>
  `,
  styles: `
    :host {
      display: block;
    }
    .sub-tabs {
      display: flex;
      gap: 24px;
      border-bottom: 1px solid var(--border-subtle);
      margin-bottom: 16px;
    }
    .sub-tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 0;
      font-size: 13px;
      color: var(--text2);
      text-decoration: none;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      transition: color 0.12s;
    }
    .sub-tab:hover {
      color: var(--text-primary);
    }
    .sub-tab.active {
      color: var(--text-primary);
      border-bottom-color: var(--text-primary);
      font-weight: 500;
    }
    .sub-tab-count {
      font-size: 12px;
      color: var(--text3);
      font-weight: 400;
    }
  `,
})
export class SubTabsComponent {
  readonly tabs = input.required<ISubTab[]>();
}
