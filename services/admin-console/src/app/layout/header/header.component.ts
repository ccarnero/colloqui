import { ChangeDetectionStrategy, Component, inject, output } from "@angular/core";
import { MatIconModule } from "@angular/material/icon";
import { MatButtonModule } from "@angular/material/button";
import { MatMenuModule } from "@angular/material/menu";
import { MatBadgeModule } from "@angular/material/badge";
import { MatDividerModule } from "@angular/material/divider";
import { TenantService } from "../../core/services/tenant.service";
import { ThemeService } from "../../core/services/theme.service";
import { AuthService } from "../../core/services/auth.service";
import { NotificationService } from "../../core/services/notification.service";

@Component({
  selector: "app-header",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatBadgeModule,
    MatDividerModule,
  ],
  template: `
    <header class="topbar">
      <div class="topbar-left flex items-center gap-4">
        <!-- Mobile Menu Toggle -->
        <button mat-icon-button class="mobile-menu-btn" (click)="toggleSidebar.emit()">
          <mat-icon>menu</mat-icon>
        </button>

        <!-- Tenant Badge (static, no dropdown) -->
        <div class="tenant-badge">
          <span class="tenant-dot"></span>
          <span class="tenant-name text-primary font-medium">{{ tenantService.currentTenant().name }}</span>
        </div>
      </div>

      <div class="topbar-right">
        <!-- Notifications -->
        <button
          mat-icon-button
          class="topbar-btn"
          [matBadge]="notificationService.unreadCount()"
          [matBadgeHidden]="notificationService.unreadCount() === 0"
          matBadgeSize="small"
          matBadgeColor="warn"
          [matMenuTriggerFor]="notifMenu"
        >
          <mat-icon>notifications_none</mat-icon>
        </button>
        <mat-menu #notifMenu="matMenu">
          <div class="notif-header">Notifications</div>
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

        <!-- Theme Toggle -->
        <button mat-icon-button class="topbar-btn" (click)="themeService.toggle()">
          <mat-icon>{{
            themeService.isDark() ? "light_mode" : "dark_mode"
          }}</mat-icon>
        </button>

        <!-- Help -->
        <button mat-icon-button class="topbar-btn">
          <mat-icon>help_outline</mat-icon>
        </button>

        <!-- Toggle Right Panel -->
        <button mat-icon-button class="topbar-btn right-panel-btn" (click)="toggleRightPanel.emit()" matTooltip="Toggle Config Panel">
          <mat-icon>tune</mat-icon>
        </button>

        <!-- User Avatar -->
        <button
          class="avatar-btn"
          [matMenuTriggerFor]="userMenu"
        >
          {{ authService.userProfile().initials }}
        </button>
        <mat-menu #userMenu="matMenu">
          <div class="user-menu-header">
            <div class="user-menu-name">{{ authService.userProfile().name }}</div>
            <div class="user-menu-email">{{ authService.userProfile().email }}</div>
            <div class="user-menu-role">{{ authService.userProfile().role }}</div>
          </div>
          <mat-divider />
          <button mat-menu-item>
            <mat-icon>person</mat-icon>
            <span>Profile</span>
          </button>
          <button mat-menu-item>
            <mat-icon>settings</mat-icon>
            <span>Settings</span>
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
      height: 64px;
      background: var(--bg-surface);
      display: flex;
      align-items: center;
      padding: 0 24px;
      justify-content: space-between;
      position: relative;
      z-index: 10;
    }

    .topbar-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .mobile-menu-btn {
      display: none;
      color: var(--text-primary);
    }

    @media (max-width: 900px) {
      .mobile-menu-btn {
        display: flex;
      }
    }

    .topbar-sep {
      width: 1px;
      height: 24px;
      background: var(--border);
    }

    .tenant-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--bg3);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 5px 12px;
      color: var(--text);
    }

    .tenant-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--green);
      flex-shrink: 0;
    }

    .tenant-name {
      font-weight: 600;
      font-size: 13px;
    }

    .topbar-right {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .topbar-btn {
      color: var(--text2);
    }

    .avatar-btn {
      width: 36px;
      height: 36px;
      margin-left: 8px;
      border-radius: 50%;
      background: linear-gradient(135deg, #4f46e5 0%, #d946ef 100%);
      border: 2px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 13px;
      color: #fff;
      letter-spacing: 0.5px;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .avatar-btn:hover {
      transform: scale(1.05);
      border-color: rgba(255, 255, 255, 0.3);
      box-shadow: 0 4px 12px rgba(217, 70, 239, 0.3);
    }
    
    .right-panel-btn {
      transition: color 0.2s;
    }
    .right-panel-btn:hover {
      color: var(--text-primary);
      background: rgba(255, 255, 255, 0.05);
    }

    .notif-header {
      padding: 8px 16px;
      font-weight: 700;
      font-size: 13px;
      border-bottom: 1px solid var(--border);
    }

    .notif-content {
      margin-left: 8px;
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
      font-weight: 600;
      font-size: 14px;
    }

    .user-menu-email {
      font-size: 12px;
      color: var(--text3);
    }

    .user-menu-role {
      font-size: 11px;
      color: var(--accent2);
      margin-top: 2px;
    }
  `,
})
export class HeaderComponent {
  protected readonly tenantService = inject(TenantService);
  protected readonly themeService = inject(ThemeService);
  protected readonly authService = inject(AuthService);
  protected readonly notificationService = inject(NotificationService);

  readonly toggleSidebar = output<void>();
  readonly toggleRightPanel = output<void>();
}
