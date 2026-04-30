import {
  ChangeDetectionStrategy,
  Component,
  input,
} from "@angular/core";
import { RouterLink } from "@angular/router";

export interface IBreadcrumb {
  label: string;
  /** When omitted, the crumb renders as plain text (e.g. the current page). */
  route?: string;
}

@Component({
  selector: "app-breadcrumbs",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <nav class="crumbs" aria-label="Breadcrumb">
      @for (c of crumbs(); track c.label; let last = $last) {
        @if (c.route && !last) {
          <a class="crumb" [routerLink]="c.route">{{ c.label }}</a>
        } @else {
          <span class="crumb crumb-current">{{ c.label }}</span>
        }
        @if (!last) {
          <span class="crumb-sep" aria-hidden="true">/</span>
        }
      }
    </nav>
  `,
  styles: `
    :host {
      display: block;
    }
    .crumbs {
      display: flex;
      align-items: center;
      gap: 0;
      font-size: 12px;
      color: var(--text2);
    }
    .crumb {
      color: var(--text2);
      text-decoration: none;
    }
    .crumb:hover {
      color: var(--text-primary);
    }
    .crumb-current {
      color: var(--text-primary);
      font-weight: 500;
    }
    .crumb-sep {
      margin: 0 8px;
      color: var(--text3);
    }
  `,
})
export class BreadcrumbsComponent {
  readonly crumbs = input.required<IBreadcrumb[]>();
}
