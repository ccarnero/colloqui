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
    <header class="topbar">
      <!-- Left: mobile toggle + brand -->
      <div class="topbar-left">
        <button
          mat-icon-button
          class="mobile-menu-btn"
          type="button"
          (click)="toggleSidebar.emit()"
          aria-label="Toggle menu"
        >
          <mat-icon>menu</mat-icon>
        </button>
        <a class="brand" routerLink="/dashboard">
          <span class="brand-mark">◆</span>
          <span class="brand-name">Yoizen</span>
        </a>
      </div>

      <!-- Center: section tabs -->
      <nav class="tab-nav" aria-label="Main navigation">
        @for (section of NAV_SECTIONS; track section.key) {
          <a
            class="tab"
            [routerLink]="section.landingPath"
            [class.active]="activeKey() === section.key"
          >{{ section.label }}</a>
        }
      </nav>

      <!-- Right: tenant + actions + avatar -->
      <div class="topbar-right">
        <div class="tenant-badge">
          <span class="tenant-dot"></span>
          <span class="tenant-name">{{ tenantService.currentTenant().name }}</span>
        </div>

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
    </header>
  `,
  styles: `
    :host {
      display: block;
    }

    .topbar {
      height: 52px;
      background: var(--rd-bg);
      border-bottom: 1px solid var(--rd-line);
      display: flex;
      align-items: stretch;
      padding: 0 var(--rd-space-11);
      gap: 0;
      position: relative;
      z-index: 100;
    }

    /* ── Left ── */
    .topbar-left {
      display: flex;
      align-items: center;
      gap: var(--rd-space-2);
      margin-right: var(--rd-space-11);
      flex-shrink: 0;
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

    .brand {
      display: flex;
      align-items: center;
      gap: var(--rd-space-4);
      text-decoration: none;
      padding: 0 var(--rd-space-4);
    }

    .brand-mark {
      font-size: var(--rd-text-size-xl);
      color: var(--rd-accent);
      line-height: 1;
    }

    .brand-name {
      font-size: var(--rd-text-size-md);
      font-weight: 600;
      color: var(--rd-text-1);
      letter-spacing: -0.02em;
    }

    /* ── Center tabs ── */
    .tab-nav {
      display: flex;
      align-items: stretch;
      flex: 1;
      gap: 0;
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

    /* ── Right ── */
    .topbar-right {
      display: flex;
      align-items: center;
      gap: var(--rd-space-1);
      margin-left: auto;
      flex-shrink: 0;
    }

    .tenant-badge {
      display: flex;
      align-items: center;
      gap: var(--rd-space-3);
      background: var(--rd-panel);
      border: 1px solid var(--rd-line);
      border-radius: var(--rd-radius-5);
      padding: var(--rd-space-2) var(--rd-space-5);
      margin-right: var(--rd-space-4);
    }

    .tenant-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--rd-green);
      flex-shrink: 0;
    }

    .tenant-name {
      font-size: var(--rd-text-size-sm);
      font-weight: 500;
      color: var(--rd-text-1);
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
