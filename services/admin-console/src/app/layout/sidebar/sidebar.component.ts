import { Component, computed, inject } from "@angular/core";
import { RouterLink, RouterLinkActive } from "@angular/router";
import { MatIconModule } from "@angular/material/icon";
import { AuthService } from "../../core/services/auth.service";

interface NavItem {
  label: string;
  icon: string;
  route?: string;
  badge?: string;
  items?: NavItem[];
}

interface NavSection {
  title: string;
  requiredPermission?: string;
  items: NavItem[];
}

const ALL_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", icon: "dashboard", route: "/dashboard" },
      {
        label: "Analytics",
        icon: "trending_up",
        route: "/analytics",
        badge: "Live",
      },
    ],
  },
  {
    title: "Identity & Access",
    requiredPermission: "users:read",
    items: [
      { label: "Users", icon: "people", route: "/users" },
      { label: "Roles & Permissions", icon: "shield", route: "/roles" },
      /*{ label: "SSO / SAML", icon: "lock", route: "/sso" },
      { label: "MFA Settings", icon: "phonelink_lock", route: "/mfa" },*/
    ],
  },
  {
    title: "Channels",
    requiredPermission: "channels:read",
    items: [
      { label: "Accounts", icon: "chat", route: "/channels" },
      { label: "Auto-Reply", icon: "reply_all", route: "/auto-reply" },
    ],
  },
  {
    title: "Automation",
    requiredPermission: "workflows:read",
    items: [
      { label: "Workflows", icon: "account_tree", route: "/workflows" },
      { label: "Webhooks", icon: "webhook", route: "/webhooks" },
      { label: "Scheduler", icon: "schedule", route: "/scheduler" },
      { label: "Rules Engine", icon: "rule", route: "/rules" },
    ],
  },
  {
    title: "Data & Integrations",
    requiredPermission: "adapters:read",
    items: [
      {
        label: "Network Sources",
        icon: "network_check",
        items: [
          {
            label: "Internal Sources",
            icon: "input_circle",
            route: "/internal-sources",
          },
          {
            label: "External Sources",
            icon: "hub",
            route: "/external-sources",
          },
        ],
      },
      { label: "Data Export", icon: "download", route: "/data-export" },
      { label: "API Keys", icon: "vpn_key", route: "/api-keys" }
    ],
  },
  {
    title: "Security & Compliance",
    requiredPermission: "audit:read",
    items: [
      {
        label: "Audit Log",
        icon: "receipt_long",
        route: "/audit-log",
        badge: "New",
      },
      {
        label: "Security Center",
        icon: "security",
        route: "/security-center",
      },
      { label: "Compliance", icon: "verified", route: "/compliance" },
      {
        label: "IP Allow List",
        icon: "language",
        route: "/ip-allowlist",
      },
      {
        label: "Data Retention",
        icon: "inventory_2",
        route: "/data-retention",
      },
    ],
  },
  {
    title: "Notifications",
    requiredPermission: "webhooks:read",
    items: [
      {
        label: "Notification Rules",
        icon: "notifications",
        route: "/notification-rules",
      },
      {
        label: "Email Templates",
        icon: "email",
        route: "/email-templates",
      },
    ],
  },
];

@Component({
  selector: "app-sidebar",
  imports: [RouterLink, RouterLinkActive, MatIconModule],
  template: `
    <nav class="leftnav">
      @for (section of visibleSections(); track section.title) {
        <div class="nav-section">
          <button
            class="nav-section-label"
            [class.collapsed]="!isSectionExpanded(section.title)"
            (click)="toggleSection(section.title)"
          >
            <span>{{ section.title }}</span>
            <mat-icon class="section-chevron">
              {{
                isSectionExpanded(section.title)
                  ? "expand_less"
                  : "expand_more"
              }}
            </mat-icon>
          </button>
          @if (isSectionExpanded(section.title)) {
            <div class="section-items">
              @for (item of section.items; track item.label) {
                @if (item.items?.length) {
                  <button
                    class="nav-item nav-parent"
                    [class.expanded]="isExpanded(item.label)"
                    (click)="toggle(item.label)"
                  >
                    <mat-icon class="nav-icon">{{ item.icon }}</mat-icon>
                    <span>{{ item.label }}</span>
                    <mat-icon class="expand-icon">
                      {{
                        isExpanded(item.label)
                          ? "expand_less"
                          : "expand_more"
                      }}
                    </mat-icon>
                  </button>
                  @if (isExpanded(item.label)) {
                    <div class="sub-items">
                      @for (child of item.items; track child.route) {
                        <a
                          class="nav-item sub-item"
                          [routerLink]="child.route"
                          routerLinkActive="active"
                        >
                          <mat-icon class="nav-icon">{{
                            child.icon
                          }}</mat-icon>
                          <span>{{ child.label }}</span>
                          @if (child.badge) {
                            <span class="nav-badge">{{ child.badge }}</span>
                          }
                        </a>
                      }
                    </div>
                  }
                } @else {
                  <a
                    class="nav-item"
                    [routerLink]="item.route"
                    routerLinkActive="active"
                  >
                    <mat-icon class="nav-icon">{{ item.icon }}</mat-icon>
                    <span>{{ item.label }}</span>
                    @if (item.badge) {
                      <span class="nav-badge">{{ item.badge }}</span>
                    }
                  </a>
                }
              }
            </div>
          }
        </div>
      }
    </nav>
  `,
  styles: `
    .leftnav {
      background: var(--bg2);
      border-right: 1px solid var(--border);
      overflow-y: auto;
      padding: 12px 0 20px;
      scrollbar-width: thin;
      scrollbar-color: var(--border) transparent;
      height: 100%;
    }

    .nav-section {
      margin-bottom: 4px;
    }

    .nav-section-label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      border: none;
      background: none;
      font-family: inherit;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.8px;
      color: var(--text3);
      text-transform: uppercase;
      padding: 10px 16px 4px;
      cursor: pointer;
      transition: color 0.1s;
    }

    .nav-section-label:hover {
      color: var(--text2);
    }

    .nav-section-label.collapsed {
      padding-bottom: 8px;
    }

    .section-chevron {
      font-size: 14px;
      width: 14px;
      height: 14px;
      opacity: 0;
      transition: opacity 0.15s;
    }

    .nav-section:hover .section-chevron,
    .nav-section-label.collapsed .section-chevron {
      opacity: 0.6;
    }

    .section-items {
      overflow: hidden;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 7px 16px;
      cursor: pointer;
      color: var(--text2);
      font-size: 13px;
      font-weight: 500;
      transition:
        background 0.1s,
        color 0.1s;
      position: relative;
      text-decoration: none;
    }

    .nav-item:hover {
      background: var(--bg3);
      color: var(--text);
    }

    .nav-item.active {
      background: var(--accent-dim);
      color: var(--accent2);
    }

    .nav-item.active::before {
      content: "";
      position: absolute;
      left: 0;
      top: 4px;
      bottom: 4px;
      width: 3px;
      border-radius: 0 3px 3px 0;
      background: var(--accent);
    }

    .nav-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      opacity: 0.8;
    }

    .nav-item.active .nav-icon {
      opacity: 1;
    }

    .nav-badge {
      margin-left: auto;
      font-size: 10px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 10px;
      background: var(--bg4);
      color: var(--text3);
    }

    .nav-item.active .nav-badge {
      background: var(--accent-dim);
      color: var(--accent2);
    }

    .nav-parent {
      width: 100%;
      border: none;
      background: none;
      text-align: left;
      font-family: inherit;
    }

    .nav-parent.expanded {
      color: var(--text);
    }

    .expand-icon {
      margin-left: auto;
      font-size: 16px;
      width: 16px;
      height: 16px;
      opacity: 0.5;
      transition: transform 0.15s ease;
    }

    .sub-items {
      overflow: hidden;
    }

    .sub-item {
      padding-left: 44px;
      font-size: 12px;
    }
  `,
})
export class SidebarComponent {
  private readonly authService = inject(AuthService);
  readonly expanded = new Set<string>();
  readonly expandedSections = new Set<string>();

  readonly visibleSections = computed(() => {
    return ALL_SECTIONS.filter((s) => {
      if (!s.requiredPermission) return true;
      return this.authService.hasPermission(s.requiredPermission);
    });
  });

  constructor() {
    for (const section of ALL_SECTIONS) {
      this.expandedSections.add(section.title);
    }
  }

  toggleSection(title: string): void {
    if (this.expandedSections.has(title)) {
      this.expandedSections.delete(title);
    } else {
      this.expandedSections.add(title);
    }
  }

  isSectionExpanded(title: string): boolean {
    return this.expandedSections.has(title);
  }

  toggle(label: string): void {
    if (this.expanded.has(label)) {
      this.expanded.delete(label);
    } else {
      this.expanded.add(label);
    }
  }

  isExpanded(label: string): boolean {
    return this.expanded.has(label);
  }
}
