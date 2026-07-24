import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  output,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { MatBadgeModule } from "@angular/material/badge";
import { MatButtonModule } from "@angular/material/button";
import { MatDividerModule } from "@angular/material/divider";
import { MatIconModule } from "@angular/material/icon";
import { MatMenuModule } from "@angular/material/menu";
import { MatTooltipModule } from "@angular/material/tooltip";
import { NavigationEnd, Router, RouterLink } from "@angular/router";
import { filter, map } from "rxjs/operators";
import { AuthService } from "../../core/services/auth.service";
import { NotificationService } from "../../core/services/notification.service";
import { TenantService } from "../../core/services/tenant.service";
import { ThemeService } from "../../core/services/theme.service";
import { NAV_SECTIONS } from "../nav/nav.config";

const LOG_PREFIX = "[HeaderComponent]";

@Component({
  selector: "app-header",
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    RouterLink,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatBadgeModule,
    MatDividerModule,
    MatTooltipModule,
  ],
  template: `
    <header class="topbar-shell">
      <!-- Row 1: breadcrumb row (org mark, tenant chip, section label) plus
           the actions cluster. T08 finding 1: mock 01-dashboard.png and
           Rediseño Terminal.dc.html (top bar block) render this as a
           dedicated row above the tab row, not inline with the tabs. The
           Search box from the mock is NEW-CAPABILITY (T08 finding 2) and is
           intentionally not built here, findings-only. -->
      <div class="topbar-crumbs">
        <button
          mat-icon-button
          class="mobile-menu-btn"
          type="button"
          (click)="toggleSidebar.emit()"
          aria-label="Toggle menu"
        >
          <mat-icon>menu</mat-icon>
        </button>

        <a class="org-mark" routerLink="/dashboard" aria-label="Yoizen home">Y</a>
        <span class="crumb-sep" aria-hidden="true">/</span>

        <!-- T08 finding 3 (tenant chip resolving to "Unknown"): verified
             against a real tenant-scoped session and it renders the real
             slug correctly; see class doc comment below for the full
             root-cause note. No behavior change made here. -->
        <span class="crumb-tenant">
          <span class="tenant-dot"></span>
          <span class="tenant-name">{{ tenantService.currentTenant().name }}</span>
        </span>
        <span class="crumb-sep" aria-hidden="true">/</span>
        <span class="crumb-section">{{ activeSectionLabel() }}</span>

        <span class="crumb-spacer"></span>

        <!-- Notifications -->
        <button
          mat-icon-button
          type="button"
          class="topbar-btn"
          [matBadge]="notificationService.unreadCount()"
          [matBadgeHidden]="notificationService.unreadCount() === 0"
          matBadgeSize="small"
          matBadgeColor="warn"
          [matMenuTriggerFor]="notifMenu"
          aria-label="Notifications"
        >
          <mat-icon>notifications_none</mat-icon>
        </button>
        <mat-menu #notifMenu="matMenu">
          <div class="notif-header">
            <span>Notifications</span>
            @if (notificationService.unreadCount() > 0) {
              <button
                mat-button
                type="button"
                (click)="notificationService.markAllRead(); $event.stopPropagation()"
              >
                Mark all read
              </button>
            }
          </div>
          @for (n of notificationService.notifications(); track n.text) {
            <button mat-menu-item>
              <span class="activity-dot" [style.background]="n.color"></span>
              <div class="notif-content">
                <div class="notif-text">{{ n.text }}</div>
                <div class="notif-time">{{ n.time }}</div>
              </div>
            </button>
          }
        </mat-menu>

        <!-- Theme toggle -->
        <button
          mat-icon-button
          type="button"
          class="topbar-btn"
          data-testid="theme-toggle"
          (click)="onThemeToggleClick()"
          [matTooltip]="themeService.isDark() ? 'Light mode' : 'Dark mode'"
        >
          <mat-icon>{{ themeService.isDark() ? "light_mode" : "dark_mode" }}</mat-icon>
        </button>

        <!-- Help -->
        <button
          mat-icon-button
          type="button"
          class="topbar-btn"
          matTooltip="Help"
          (click)="onHelpClick()"
        >
          <mat-icon>help_outline</mat-icon>
        </button>

        <!-- Avatar -->
        <button class="avatar-btn" [matMenuTriggerFor]="userMenu" type="button">
          {{ authService.userProfile().initials }}
        </button>
        <mat-menu #userMenu="matMenu">
          <div class="user-menu-header">
            <div class="user-menu-name">{{ authService.userProfile().name }}</div>
            <div class="user-menu-email">{{ authService.userProfile().email }}</div>
            <div class="user-menu-role">{{ authService.userProfile().role }}</div>
          </div>
          <mat-divider />
          <button mat-menu-item disabled>
            <mat-icon>person</mat-icon>
            <span>Profile</span>
          </button>
          <mat-divider />
          <button mat-menu-item (click)="authService.logout()">
            <mat-icon>logout</mat-icon>
            <span>Sign out</span>
          </button>
        </mat-menu>
      </div>

      <!-- Row 2: section tabs, per the mock's separate tab row below the
           breadcrumb row (T08 finding 1). -->
      <nav class="tab-nav" aria-label="Main navigation">
        @for (section of NAV_SECTIONS; track section.key) {
          <a
            class="tab"
            [routerLink]="section.landingPath"
            [class.active]="activeKey() === section.key"
          >{{ section.label }}</a>
        }
      </nav>
    </header>
  `,
  styles: `
    :host {
      display: block;
    }

    .topbar-shell {
      display: flex;
      flex-direction: column;
      background: var(--rd-bg);
      position: relative;
      z-index: 100;
    }

    /* Row 1: breadcrumb row (T08 finding 1 restructure). Height comes from
       the shared topbar tokens (styles.scss) so full-bleed views can
       subtract the real header height. */
    .topbar-crumbs {
      height: var(--rd-topbar-crumbs-h, 52px);
      flex-shrink: 0;
      display: flex;
      align-items: center;
      padding: 0 var(--rd-space-11);
      gap: var(--rd-space-5);
      border-bottom: 1px solid var(--rd-line);
    }

    .mobile-menu-btn {
      display: none;
      color: var(--rd-text-2);
    }

    @media (max-width: 900px) {
      .mobile-menu-btn {
        display: flex;
      }
    }

    .org-mark {
      width: 22px;
      height: 22px;
      border-radius: var(--rd-radius-6);
      background: var(--rd-accent);
      color: var(--rd-text-on-accent);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--rd-text-size-xs);
      font-weight: 700;
      flex-shrink: 0;
      text-decoration: none;
    }

    .crumb-sep {
      color: var(--rd-line);
    }

    .crumb-tenant {
      display: flex;
      align-items: center;
      gap: var(--rd-space-3);
      font-size: var(--rd-text-size-sm);
      color: var(--rd-text-2);
    }

    .tenant-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--rd-green);
      flex-shrink: 0;
    }

    .crumb-section {
      font-size: var(--rd-text-size-sm);
      font-weight: 500;
      color: var(--rd-text-1);
    }

    .crumb-spacer {
      flex: 1;
    }

    /* Row 2: section tabs (T08 finding 1 restructure). Fixed height (shared
       topbar token) — content-driven height here would desync
       --rd-topbar-h from reality. */
    .tab-nav {
      display: flex;
      height: var(--rd-topbar-tabs-h, 21px);
      align-items: stretch;
      padding: 0 var(--rd-space-8);
      gap: 0;
      border-bottom: 1px solid var(--rd-line);
    }

    .tab {
      display: flex;
      align-items: center;
      padding: 0 var(--rd-space-7);
      font-size: var(--rd-text-size-base);
      font-weight: 400;
      color: var(--rd-text-2);
      text-decoration: none;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      transition: color 0.12s;
      white-space: nowrap;
    }

    .tab:hover {
      color: var(--rd-text-1);
    }

    .tab.active {
      color: var(--rd-accent);
      border-bottom-color: var(--rd-accent);
      font-weight: 500;
    }

    @media (max-width: 900px) {
      .tab-nav {
        display: none;
      }
    }

    .topbar-btn {
      color: var(--rd-text-2);
    }

    .topbar-btn:hover {
      background: var(--rd-hover);
      color: var(--rd-text-1);
    }

    .topbar-btn:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px var(--rd-accent);
    }

    .avatar-btn {
      width: 30px;
      height: 30px;
      margin-left: var(--rd-space-3);
      border-radius: 50%;
      background: var(--rd-avatar-gradient);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--rd-text-size-2xs);
      font-weight: 600;
      color: var(--rd-text-on-accent);
      letter-spacing: 0.02em;
      transition: opacity 0.15s;
    }

    .avatar-btn:hover {
      opacity: 0.88;
    }

    .notif-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--rd-space-4) var(--rd-space-8);
      font-size: var(--rd-text-size-base);
      font-weight: 600;
      border-bottom: 1px solid var(--rd-line);
    }

    .activity-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: var(--rd-space-2);
      flex-shrink: 0;
    }

    .notif-content {
      display: flex;
      flex-direction: column;
    }

    .notif-text {
      font-size: var(--rd-text-size-sm);
    }

    .notif-time {
      font-size: var(--rd-text-size-xs);
      color: var(--rd-text-3);
    }

    .user-menu-header {
      padding: var(--rd-space-6) var(--rd-space-8);
    }

    .user-menu-name {
      font-size: var(--rd-text-size-md);
      font-weight: 600;
      color: var(--rd-text-1);
    }

    .user-menu-email {
      font-size: var(--rd-text-size-sm);
      color: var(--rd-text-3);
      margin-top: var(--rd-space-1);
    }

    .user-menu-role {
      font-size: var(--rd-text-size-xs);
      color: var(--rd-accent);
      margin-top: var(--rd-space-1);
    }
  `,
})
export class HeaderComponent implements OnInit {
  protected readonly tenantService = inject(TenantService);
  protected readonly themeService = inject(ThemeService);
  protected readonly authService = inject(AuthService);
  protected readonly notificationService = inject(NotificationService);
  private readonly router = inject(Router);

  /** Keep for backward compat with shell wiring. */
  readonly toggleSidebar = output<void>();
  readonly toggleRightPanel = output<void>();

  /** Expose section list to template. */
  protected readonly NAV_SECTIONS = NAV_SECTIONS;

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map((e) => (e as NavigationEnd).urlAfterRedirects)
    ),
    { initialValue: this.router.url }
  );

  readonly activeKey = computed(() => {
    const url = this.url();
    return (
      NAV_SECTIONS.find((s) =>
        s.matchPaths.some((p) => url === p || url.startsWith(p + "/"))
      )?.key ?? "overview"
    );
  });

  /**
   * Breadcrumb-row section label (T08 finding 1 — mock's row 1 shows the
   * active top-level section name, e.g. "Overview" or "Settings", not the
   * page title). Falls back to the first section's label so the crumb
   * never renders blank if activeKey somehow doesn't match.
   */
  readonly activeSectionLabel = computed(() => {
    const key = this.activeKey();
    const section = NAV_SECTIONS.find((s) => s.key === key) ?? NAV_SECTIONS[0];
    return section.label;
  });

  ngOnInit(): void {
    if (this.notificationService.notifications().length === 0) {
      this.notificationService.push({
        color: "#4f46e5",
        text: "Welcome to the Admin Console",
        time: new Date().toLocaleString(),
      });
    }
  }

  /**
   * Theme toggle handler wired to the header button (T03). Delegates all
   * persistence/DOM work to the existing `ThemeService.toggle()` — this
   * handler only logs the interaction so the toggle never fails silently.
   */
  protected onThemeToggleClick(): void {
    const wasDark = this.themeService.isDark();
    console.debug(
      `${LOG_PREFIX} theme toggle clicked, current isDark=${wasDark}`
    );
    this.themeService.toggle();
  }

  protected onHelpClick(): void {
    this.notificationService.push({
      color: "#6366f1",
      text: "Help: use the top navigation to switch sections.",
      time: new Date().toLocaleString(),
    });
  }
}
