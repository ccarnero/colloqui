import { Component, inject, signal } from "@angular/core";
import { MatSlideToggleModule } from "@angular/material/slide-toggle";
import { TenantService } from "../../../core/services/tenant.service";
import { StatusBadgeComponent } from "../../../shared/components/status-badge/status-badge.component";

@Component({
  selector: "app-sso",
  imports: [MatSlideToggleModule, StatusBadgeComponent],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Single Sign-On (SSO)</div>
        <div class="ws-subtitle">
          SAML / OIDC for {{ tenant.currentTenant().name }}
        </div>
      </div>
    </div>

    <div class="section-card">
      <div class="sso-list">
        @for (p of providers; track p.id) {
          <div class="sso-row">
            <div class="sso-info">
              <div class="sso-name">{{ p.name }}</div>
              <div class="sso-meta">{{ p.detail }}</div>
            </div>
            <mat-slide-toggle
              [checked]="enabled().get(p.id) ?? false"
              (change)="toggle(p.id, $event.checked)"
            />
            <app-status-badge [status]="p.statusLabel" [color]="p.badgeColor" />
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    .sso-list {
      display: flex;
      flex-direction: column;
      gap: 0;
    }
    .sso-row {
      display: grid;
      grid-template-columns: 1fr auto auto;
      align-items: center;
      gap: 16px;
      padding: 16px 0;
      border-bottom: 1px solid var(--border);
    }
    .sso-row:last-child {
      border-bottom: none;
    }
    .sso-name {
      font-weight: 600;
    }
    .sso-meta {
      font-size: 13px;
      color: var(--text3);
      margin-top: 4px;
    }
  `,
})
export class SsoComponent {
  protected readonly tenant = inject(TenantService);

  readonly providers = [
    {
      id: "google",
      name: "Google Workspace",
      detail: "SAML 2.0 · Primary domain verified",
      statusLabel: "Connected",
      badgeColor: "green" as const,
    },
    {
      id: "okta",
      name: "Okta",
      detail: "OIDC · dev-123.okta.com",
      statusLabel: "Not configured",
      badgeColor: "gray" as const,
    },
    {
      id: "azure",
      name: "Azure AD",
      detail: "SAML 2.0 · Tenant ID configured",
      statusLabel: "Error",
      badgeColor: "red" as const,
    },
  ];

  private readonly initialEnabled = new Map<string, boolean>([
    ["google", true],
    ["okta", false],
    ["azure", false],
  ]);

  protected readonly enabled = signal<Map<string, boolean>>(
    new Map(this.initialEnabled),
  );

  protected toggle(id: string, value: boolean): void {
    const next = new Map(this.enabled());
    next.set(id, value);
    this.enabled.set(next);
  }
}
