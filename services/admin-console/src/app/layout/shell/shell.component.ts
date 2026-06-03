import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import {
  ActivatedRoute,
  Router,
  RouterOutlet,
  NavigationEnd,
} from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { filter } from "rxjs/operators";
import { HeaderComponent } from "../header/header.component";
import { SubNavComponent } from "../sub-nav/sub-nav.component";
import { TenantService } from "../../core/services/tenant.service";
import { NavIndicatorRegistry } from "../../core/services/metrics/nav-indicator-registry.service";

/**
 * Walks the activated route tree looking for the deepest `data.subNavCollapsed`
 * value. Pages that want a roomy canvas (Builder) set this on their route data:
 *   { path: "...", data: { subNavCollapsed: true }, ... }
 */
function readCollapsedFlag(route: ActivatedRoute | null): boolean {
  let r: ActivatedRoute | null = route;
  let collapsed = false;
  while (r) {
    const flag = r.snapshot.data?.["subNavCollapsed"];
    if (typeof flag === "boolean") {
      collapsed = flag;
    }
    r = r.firstChild;
  }
  return collapsed;
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

        <app-sub-nav
          [mobileOpen]="mobileNavOpen()"
          [collapsed]="subNavCollapsed()"
          (mobileClose)="mobileNavOpen.set(false)"
        />

        <main class="shell-main">
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
      background: var(--bg-background);
      color: var(--text-primary);
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
      padding: 28px;
      background: var(--bg-background);
      scrollbar-width: thin;
      scrollbar-color: var(--border-subtle) transparent;
    }

    .mobile-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      z-index: 30;
    }

    @media (max-width: 900px) {
      .shell-main {
        padding: 20px 16px;
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
   * Recomputes on every NavigationEnd by reading route data.subNavCollapsed
   * down the active route tree. Builder routes set this to true for a roomy
   * canvas; everything else defaults to false.
   */
  private readonly navEnd = toSignal(
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)),
    { initialValue: null },
  );

  readonly subNavCollapsed = computed(() => {
    // Touch navEnd so this recomputes on every navigation.
    this.navEnd();
    return readCollapsedFlag(this.route);
  });

  ngOnInit(): void {
    this.tenantService.loadTenantDetails();
    this.navIndicators.loadAll();
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.mobileNavOpen.set(false));
  }
}
