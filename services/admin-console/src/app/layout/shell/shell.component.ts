import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterOutlet,
} from "@angular/router";
import { filter } from "rxjs/operators";
import { NavIndicatorRegistry } from "../../core/services/metrics/nav-indicator-registry.service";
import { TenantService } from "../../core/services/tenant.service";
import { HeaderComponent } from "../header/header.component";
import { SubNavComponent } from "../sub-nav/sub-nav.component";

/**
 * Walks the activated route tree looking for the deepest boolean value of
 * `data[key]`. Shared by the `subNavCollapsed` (icon-only rail, e.g. the AI
 * agent editor) and `subNavHidden` (rail fully removed, e.g. the full-bleed
 * workflow builder — SPEC amendment 2026-07-22, decision 3) route-data
 * flags:
 *   { path: "...", data: { subNavCollapsed: true }, ... }
 *   { path: "...", data: { subNavHidden: true }, ... }
 */
function readRouteDataFlag(
  route: ActivatedRoute | null,
  key: "subNavCollapsed" | "subNavHidden"
): boolean {
  let r: ActivatedRoute | null = route;
  let value = false;
  while (r) {
    const flag = r.snapshot.data?.[key];
    if (typeof flag === "boolean") {
      value = flag;
    }
    r = r.firstChild;
  }
  return value;
}

@Component({
  selector: "app-shell",
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, SubNavComponent],
  template: `
    <div class="shell" [class.mobile-nav-open]="mobileNavOpen()">
      <!-- Top bar with underline tab-nav -->
      <app-header (toggleSidebar)="mobileNavOpen.set(!mobileNavOpen())" />

      <!-- Body: sub-nav + main content -->
      <div class="shell-body">
        @if (mobileNavOpen()) {
          <div
            class="mobile-overlay"
            (click)="mobileNavOpen.set(false)"
            aria-hidden="true"
          ></div>
        }

        @if (!subNavHidden()) {
          <app-sub-nav
            [mobileOpen]="mobileNavOpen()"
            [collapsed]="subNavCollapsed()"
            (mobileClose)="mobileNavOpen.set(false)"
          />
        }

        <main class="shell-main" [class.full-bleed]="subNavHidden()">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      height: 100vh;
      overflow: hidden;
    }

    .shell {
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: var(--rd-bg);
      color: var(--rd-text-1);
    }

    .shell-body {
      display: flex;
      flex: 1;
      overflow: hidden;
      position: relative;
    }

    .shell-main {
      flex: 1;
      overflow-y: auto;
      padding: var(--rd-space-12);
      background: var(--rd-bg);
      scrollbar-width: thin;
      scrollbar-color: var(--rd-line) transparent;
    }

    /*
     * Full-bleed routes (the workflow builder, per SPEC decision 3
     * amendment): the app header/tabs stay visible, but the main content
     * area drops its padding so the canvas runs edge-to-edge and the
     * builder's own floating chrome can overlay it, matching the design's
     * mainPad: 0 rule for the builder screen.
     */
    .shell-main.full-bleed {
      padding: 0;
      overflow: hidden;
    }

    .mobile-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      z-index: 30;
    }

    @media (max-width: 900px) {
      .shell-main:not(.full-bleed) {
        padding: var(--rd-space-10) var(--rd-space-8);
      }
    }
  `,
})
export class ShellComponent implements OnInit {
  private readonly tenantService = inject(TenantService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly navIndicators = inject(NavIndicatorRegistry);

  readonly mobileNavOpen = signal(false);

  /**
   * Recomputes on every NavigationEnd by reading route data down the active
   * route tree. The AI agent editor routes set `subNavCollapsed: true` for
   * an icon-only rail; everything else defaults to false.
   */
  private readonly navEnd = toSignal(
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)),
    { initialValue: null }
  );

  readonly subNavCollapsed = computed(() => {
    // Touch navEnd so this recomputes on every navigation.
    this.navEnd();
    return readRouteDataFlag(this.route, "subNavCollapsed");
  });

  /**
   * Full-bleed routes (currently the workflow builder — SPEC decision 3
   * amendment 2026-07-22) set `subNavHidden: true` to remove the sub-nav
   * rail entirely, rather than collapsing it to icon-mode. The app header
   * stays visible per the amendment; only this rail hides.
   */
  readonly subNavHidden = computed(() => {
    this.navEnd();
    const hidden = readRouteDataFlag(this.route, "subNavHidden");
    console.debug("[ShellComponent] sub-nav hidden state recomputed", {
      hidden,
      url: this.router.url,
    });
    return hidden;
  });

  ngOnInit(): void {
    this.tenantService.loadTenantDetails();
    this.navIndicators.loadAll();
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.mobileNavOpen.set(false));
  }
}
