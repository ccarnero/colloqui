import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from "@angular/core";
import {
  Router,
  RouterLink,
  RouterLinkActive,
  NavigationEnd,
} from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { filter, map } from "rxjs/operators";
import {
  type INavIndicator,
  type INavPage,
  NAV_SECTIONS,
} from "../nav/nav.config";
import { NavIndicatorRegistry } from "../../core/services/metrics/nav-indicator-registry.service";

/**
 * View-model for a sub-nav page including its resolved indicator value.
 * `indicatorValue()` is null when there is no indicator, no signal, or the
 * signal currently holds null/0 (in which case the indicator hides).
 */
interface ISubNavPageVm {
  page: INavPage;
  indicator: INavIndicator | null;
  /** Signal of the resolved value (or static null if unresolvable). */
  indicatorValue: () => number | null;
}

@Component({
  selector: "app-sub-nav",
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    @if (activeSection(); as section) {
      <nav
        class="sub-nav"
        [class.collapsed]="collapsed()"
        [class.mobile-open]="mobileOpen()"
        [attr.aria-label]="section.label + ' navigation'"
      >
        @for (vm of pages(); track vm.page.route) {
          @if (vm.page.dividerBefore && !collapsed()) {
            <div class="nav-divider"></div>
          }
          <a
            class="nav-item"
            [routerLink]="vm.page.route"
            routerLinkActive="active"
            [routerLinkActiveOptions]="{ exact: vm.page.route === '/dashboard' }"
            [attr.title]="collapsed() ? vm.page.label : null"
            (click)="mobileClose.emit()"
          >
            <span class="nav-label">{{ collapsed() ? abbrev(vm.page.label) : vm.page.label }}</span>
            @if (vm.indicator && indicatorVisible(vm)) {
              <span
                class="nav-indicator"
                [class]="'ind-' + vm.indicator.kind"
                [attr.aria-label]="indicatorAriaLabel(vm)"
              >
                @if (vm.indicator.kind !== 'dot') {
                  {{ vm.indicatorValue() }}
                }
              </span>
            }
          </a>
        }
      </nav>
    }
  `,
  styles: `
    :host {
      display: contents;
    }

    .sub-nav {
      width: 180px;
      min-width: 180px;
      border-right: 1px solid var(--border-subtle);
      padding: 12px 0;
      background: var(--bg-surface);
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: var(--border-subtle) transparent;
      transition: width 0.15s ease, min-width 0.15s ease;
    }

    .sub-nav.collapsed {
      width: 48px;
      min-width: 48px;
      padding: 12px 4px;
      align-items: center;
    }

    .nav-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 13px;
      font-weight: 400;
      padding: 7px 20px;
      color: var(--text2);
      text-decoration: none;
      border-left: 2px solid transparent;
      transition: color 0.12s, background 0.12s;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .sub-nav.collapsed .nav-item {
      width: 36px;
      height: 32px;
      padding: 0;
      justify-content: center;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      margin: 2px 0;
      background: var(--bg-background);
      color: var(--text2);
    }

    .nav-item:hover {
      color: var(--text-primary);
      background: var(--bg3);
    }

    .nav-item.active {
      color: var(--primary, #1a66ff);
      background: var(--accent-dim, rgba(26, 102, 255, 0.06));
      border-left-color: var(--primary, #1a66ff);
      font-weight: 500;
    }

    .sub-nav.collapsed .nav-item.active {
      border-color: var(--primary, #1a66ff);
      background: var(--accent-dim, rgba(26, 102, 255, 0.06));
    }

    .nav-label {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .sub-nav.collapsed .nav-label {
      font-size: 11px;
      font-weight: 500;
    }

    .nav-indicator {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 16px;
      padding: 0 5px;
      font-size: 11px;
      font-weight: 500;
      border-radius: 999px;
      flex-shrink: 0;
    }

    .ind-count {
      color: var(--text3);
      background: transparent;
    }

    .ind-count-warn {
      color: var(--yellow, #b45309);
      background: color-mix(in srgb, var(--yellow, #eab308) 18%, transparent);
    }

    .ind-count-danger {
      color: var(--red, #b91c1c);
      background: color-mix(in srgb, var(--red, #ef4444) 18%, transparent);
    }

    .ind-dot {
      min-width: 7px;
      width: 7px;
      height: 7px;
      padding: 0;
      background: var(--red, #ef4444);
    }

    .nav-divider {
      height: 1px;
      background: var(--border-subtle);
      margin: 6px 0;
    }

    @media (max-width: 900px) {
      .sub-nav {
        position: fixed;
        top: 56px;
        left: -200px;
        bottom: 0;
        z-index: 40;
        transition: transform 0.25s ease;
        width: 200px;
        min-width: 200px;
      }

      .sub-nav.mobile-open {
        transform: translateX(200px);
        box-shadow: 4px 0 20px rgba(0, 0, 0, 0.15);
      }
    }
  `,
})
export class SubNavComponent {
  private readonly router = inject(Router);
  private readonly indicators = inject(NavIndicatorRegistry);

  readonly mobileOpen = input(false);
  readonly collapsed = input(false);
  readonly mobileClose = output<void>();

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map((e) => (e as NavigationEnd).urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  readonly activeSection = computed(() => {
    const url = this.url();
    return (
      NAV_SECTIONS.find((s) =>
        s.matchPaths.some((p) => url === p || url.startsWith(p + "/")),
      ) ?? null
    );
  });

  /**
   * Page list with resolved indicator signals. Each page's indicator is
   * looked up once via the registry; if no signal exists for the source
   * (Phase 1), the indicator stays inert.
   */
  readonly pages = computed<ISubNavPageVm[]>(() => {
    const section = this.activeSection();
    if (!section) return [];
    return section.pages.map((page) => {
      const indicator = page.indicator ?? null;
      const sig = indicator ? this.indicators.resolve(indicator.source) : null;
      return {
        page,
        indicator,
        indicatorValue: () => (sig ? sig() : null),
      };
    });
  });

  protected indicatorVisible(vm: ISubNavPageVm): boolean {
    if (!vm.indicator) return false;
    if (vm.indicator.kind === "dot") return true;
    const v = vm.indicatorValue();
    return v !== null && v > 0;
  }

  protected indicatorAriaLabel(vm: ISubNavPageVm): string {
    if (!vm.indicator) return "";
    const v = vm.indicatorValue();
    return vm.indicator.kind === "dot"
      ? `${vm.page.label} alert`
      : `${v ?? 0} ${vm.page.label}`;
  }

  /** Two-letter abbreviation for collapsed-mode rendering. */
  protected abbrev(label: string): string {
    const parts = label.replace(/[&]/g, "").trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
    }
    return label.slice(0, 2).toUpperCase();
  }
}
