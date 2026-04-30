import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { RouterLink, RouterLinkActive } from "@angular/router";
import { MatTooltipModule } from "@angular/material/tooltip";
import {
  LucideAngularModule,
  LogOut,
  MessageSquare,
  Plus,
} from "lucide-angular";
import { AuthService } from "../../core/services/auth.service";

@Component({
  selector: "app-header",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    RouterLinkActive,
    MatTooltipModule,
    LucideAngularModule,
  ],
  template: `
    <header class="header">
      <div class="header-left">
        <span class="brand">
          <lucide-icon [img]="MessageSquare" [size]="20" />
          Messaging Console
        </span>
        <nav class="nav-links">
          <a routerLink="/accounts"
             routerLinkActive="active"
             [routerLinkActiveOptions]="{ exact: true }"
             class="nav-link">
            Accounts
          </a>
          <a routerLink="/messaging"
             routerLinkActive="active"
             class="nav-link">
            Send Message
          </a>
          <a routerLink="/auto-reply"
             routerLinkActive="active"
             class="nav-link">
            Auto-Reply
          </a>
        </nav>
      </div>
      <div class="header-right">
        <button class="btn btn-sm btn-primary"
                routerLink="/connect"
                matTooltip="Connect new account">
          <lucide-icon [img]="Plus" [size]="14" />
          Connect
        </button>
        <span class="user-info">{{ profile().initials }}</span>
        <button class="icon-btn" matTooltip="Logout" (click)="logout()">
          <lucide-icon [img]="LogOut" [size]="16" />
        </button>
      </div>
    </header>
  `,
  styles: `
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      height: 52px;
      background: var(--bg2);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 24px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      font-size: 15px;
      color: var(--accent);
      white-space: nowrap;
    }
    .nav-links {
      display: flex;
      gap: 4px;
    }
    .nav-link {
      padding: 6px 12px;
      border-radius: var(--radius);
      font-size: 13px;
      font-weight: 500;
      color: var(--text3);
      text-decoration: none;
      transition: all 0.15s;
    }
    .nav-link:hover {
      color: var(--text);
      background: var(--bg3);
    }
    .nav-link.active {
      color: var(--text);
      background: var(--bg3);
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .user-info {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: var(--bg4);
      font-size: 11px;
      font-weight: 700;
      color: var(--text2);
    }
    .icon-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: var(--radius);
      background: none;
      border: none;
      color: var(--text3);
      cursor: pointer;
      transition: all 0.15s;
    }
    .icon-btn:hover {
      color: var(--text);
      background: var(--bg3);
    }
  `,
})
export class HeaderComponent {
  protected readonly MessageSquare = MessageSquare;
  protected readonly Plus = Plus;
  protected readonly LogOut = LogOut;

  private readonly auth = inject(AuthService);
  readonly profile = this.auth.userProfile;

  logout(): void {
    this.auth.logout();
  }
}
