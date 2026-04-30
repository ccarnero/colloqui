import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  output,
} from "@angular/core";
import { Router, RouterLink, NavigationEnd } from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { filter, map } from "rxjs/operators";
import { MatIconModule } from "@angular/material/icon";
import { MatButtonModule } from "@angular/material/button";
import { MatMenuModule } from "@angular/material/menu";
import { MatBadgeModule } from "@angular/material/badge";
import { MatDividerModule } from "@angular/material/divider";
import { MatTooltipModule } from "@angular/material/tooltip";
import { TenantService } from "../../core/services/tenant.service";
import { ThemeService } from "../../core/services/theme.service";
import { AuthService } from "../../core/services/auth.service";
import { NotificationService } from "../../core/services/notification.service";
import { NAV_SECTIONS } from "../nav/nav.config";

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
            [routerLink]="section.pages[0].route"
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
          (click)="themeService.toggle()"
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
      height: 56px;
      background: var(--bg-surface);
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      align-items: stretch;
      padding: 0 20px 0 16px;
      gap: 0;
      position: relative;
      z-index: 100;
    }

    /* ── Left ── */
    .topbar-left {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-right: 24px;
      flex-shrink: 0;
    }

    .mobile-menu-btn {
      display: none;
      color: var(--text2);
    }

    @media (max-width: 900px) {
      .mobile-menu-btn {
        display: flex;
      }
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      text-decoration: none;
      padding: 0 8px;
    }

    .brand-mark {
      font-size: 16px;
      color: var(--primary, #1a66ff);
      line-height: 1;
    }

    .brand-name {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      letter-spacing: -0.2px;
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
      padding: 0 14px;
      font-size: 13px;
      font-weight: 400;
      color: var(--text2);
      text-decoration: none;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      transition: color 0.12s;
      white-space: nowrap;
    }

    .tab:hover {
      color: var(--text-primary);
    }

    .tab.active {
      color: var(--primary, #1a66ff);
      border-bottom-color: var(--primary, #1a66ff);
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
      gap: 2px;
      margin-left: auto;
      flex-shrink: 0;
    }

    .tenant-badge {
      display: flex;
      align-items: center;
      gap: 7px;
      background: var(--bg3);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius, 6px);
      padding: 4px 10px;
      margin-right: 8px;
    }

    .tenant-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--green, #10b981);
      flex-shrink: 0;
    }

    .tenant-name {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-primary);
    }

    .topbar-btn {
      color: var(--text2);
    }

    .avatar-btn {
      width: 32px;
      height: 32px;
      margin-left: 6px;
      border-radius: 50%;
      background: linear-gradient(135deg, #4f46e5 0%, #d946ef 100%);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 600;
      color: #fff;
      letter-spacing: 0.3px;
      transition: opacity 0.15s;
    }

    .avatar-btn:hover {
      opacity: 0.88;
    }

    .notif-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 600;
      border-bottom: 1px solid var(--border-subtle);
    }

    .activity-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 4px;
      flex-shrink: 0;
    }

    .notif-content {
      display: flex;
      flex-direction: column;
    }

    .notif-text {
      font-size: 12px;
    }

    .notif-time {
      font-size: 11px;
      color: var(--text3);
    }

    .user-menu-header {
      padding: 12px 16px;
    }

    .user-menu-name {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .user-menu-email {
      font-size: 12px;
      color: var(--text3);
      margin-top: 2px;
    }

    .user-menu-role {
      font-size: 11px;
      color: var(--accent2);
      margin-top: 2px;
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
      map((e) => (e as NavigationEnd).urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  readonly activeKey = computed(() => {
    const url = this.url();
    return (
      NAV_SECTIONS.find((s) =>
        s.matchPaths.some((p) => url === p || url.startsWith(p + "/")),
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

  protected onHelpClick(): void {
    this.notificationService.push({
      color: "#6366f1",
      text: "Help: use the top navigation to switch sections.",
      time: new Date().toLocaleString(),
    });
  }
}
