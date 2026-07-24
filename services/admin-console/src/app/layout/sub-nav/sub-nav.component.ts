import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
} from "@angular/router";
import { filter, map } from "rxjs/operators";
import { NavIndicatorRegistry } from "../../core/services/metrics/nav-indicator-registry.service";
import {
  type INavIndicator,
  type INavPage,
  NAV_SECTIONS,
} from "../nav/nav.config";

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
                [attr.aria-label]="collapsed() ? null : indicatorAriaLabel(vm)"
                [attr.aria-hidden]="collapsed()"
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
      width: 210px;
      min-width: 210px;
      border-right: 1px solid var(--rd-line);
      padding: var(--rd-space-12) var(--rd-space-8);
      background: var(--rd-bg);
      display: flex;
      flex-direction: column;
      gap: var(--rd-space-1);
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: var(--rd-line) transparent;
      transition: width 0.15s ease, min-width 0.15s ease;
    }

    .sub-nav.collapsed {
      width: 56px;
      min-width: 56px;
      padding: var(--rd-space-6) 0;
      align-items: stretch;
    }

    .nav-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--rd-space-4);
      font-size: var(--rd-text-size-base);
      font-weight: 400;
      padding: var(--rd-space-3) var(--rd-space-5);
      border-radius: var(--rd-radius-5);
      color: var(--rd-text-2);
      text-decoration: none;
      transition: color 0.12s, background 0.12s;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .sub-nav.collapsed .nav-item {
      width: 100%;
      height: 40px;
      padding: 0;
      justify-content: center;
      border-radius: 0;
      margin: 0;
      background: transparent;
      color: var(--rd-text-2);
      position: relative;
      border-left: 2px solid transparent;
    }

    .sub-nav.collapsed .nav-item:hover {
      background: var(--rd-hover);
      color: var(--rd-text-1);
    }

    .sub-nav.collapsed .nav-item.active {
      border-left-color: var(--rd-accent);
      background: var(--rd-hover);
      color: var(--rd-text-1);
    }

    .sub-nav.collapsed .nav-indicator {
      position: absolute;
      top: 3px;
      right: 4px;
      min-width: 14px;
      height: 14px;
      padding: 0 var(--rd-space-2);
      font-size: var(--rd-text-size-2xs);
      font-weight: 600;
      line-height: 14px;
      border-radius: var(--rd-radius-full);
      background: var(--rd-accent);
      color: var(--rd-text-on-accent);
      box-shadow: var(--rd-shadow-sm);
    }

    .sub-nav.collapsed .ind-count {
      background: var(--rd-accent);
      color: var(--rd-text-on-accent);
    }

    .sub-nav.collapsed .ind-count-warn {
      background: var(--rd-yellow);
      color: var(--rd-bg);
    }

    .sub-nav.collapsed .ind-count-danger {
      background: var(--rd-red);
      color: var(--rd-text-on-accent);
    }

    .sub-nav.collapsed .ind-dot {
      position: absolute;
      top: 5px;
      right: 8px;
      width: 6px;
      height: 6px;
      background: var(--rd-red);
      border-radius: 50%;
    }

    /* Active/hover state is a neutral surface highlight (bg-hover, text-1),
       matching the sub-rail treatment in the design file — primary nav
       (topbar tabs) carries the accent color, secondary nav (this rail)
       stays neutral. */
    .nav-item:hover {
      color: var(--rd-text-1);
      background: var(--rd-hover);
    }

    .nav-item.active {
      color: var(--rd-text-1);
      background: var(--rd-hover);
      font-weight: 500;
    }

    .nav-label {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .sub-nav.collapsed .nav-label {
      font-size: var(--rd-text-size-base);
      font-weight: 600;
      letter-spacing: 0.04em;
    }

    .nav-indicator {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 16px;
      padding: 0 var(--rd-space-3);
      font-size: var(--rd-text-size-xs);
      font-weight: 500;
      border-radius: var(--rd-radius-full);
      flex-shrink: 0;
      font-family: var(--rd-font-mono);
    }

    .ind-count {
      color: var(--rd-text-3);
      background: transparent;
    }

    .ind-count-warn {
      color: var(--rd-yellow);
      background: var(--rd-yellow-dim);
    }

    .ind-count-danger {
      color: var(--rd-red);
      background: var(--rd-red-dim);
    }

    .ind-dot {
      min-width: 7px;
      width: 7px;
      height: 7px;
      padding: 0;
      background: var(--rd-red);
    }

    .nav-divider {
      height: 1px;
      background: var(--rd-line);
      margin: var(--rd-space-3) 0;
    }

    @media (max-width: 900px) {
      .sub-nav {
        position: fixed;
        /* Below the full two-row topbar (shared token, styles.scss) — a
           hard-coded 52px would underlap the header's tab row (T08). */
        top: var(--rd-topbar-h, 75px);
        left: -200px;
        bottom: 0;
        z-index: 40;
        transition: transform 0.25s ease;
        width: 200px;
        min-width: 200px;
      }

      .sub-nav.mobile-open {
        transform: translateX(200px);
        box-shadow: var(--rd-shadow-lg);
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
      map((e) => (e as NavigationEnd).urlAfterRedirects)
    ),
    { initialValue: this.router.url }
  );

  readonly activeSection = computed(() => {
    const url = this.url();
    return (
      NAV_SECTIONS.find((s) =>
        s.matchPaths.some((p) => url === p || url.startsWith(p + "/"))
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
    if (!section) {
      return [];
    }
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
    if (!vm.indicator) {
      return false;
    }
    if (vm.indicator.kind === "dot") {
      return true;
    }
    const v = vm.indicatorValue();
    return v !== null && v > 0;
  }

  protected indicatorAriaLabel(vm: ISubNavPageVm): string {
    if (!vm.indicator) {
      return "";
    }
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
