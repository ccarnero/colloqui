import {
  ChangeDetectionStrategy,
  Component,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import { Router, RouterOutlet, NavigationEnd } from "@angular/router";
import { filter } from "rxjs/operators";
import { HeaderComponent } from "../header/header.component";
import { SubNavComponent } from "../sub-nav/sub-nav.component";
import { TenantService } from "../../core/services/tenant.service";

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

  readonly mobileNavOpen = signal(false);

  ngOnInit(): void {
    this.tenantService.loadTenantDetails();
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.mobileNavOpen.set(false));
  }
}
