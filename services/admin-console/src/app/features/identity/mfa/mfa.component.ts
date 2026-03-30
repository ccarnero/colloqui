import { Component, inject, signal } from "@angular/core";
import { MatSlideToggleModule } from "@angular/material/slide-toggle";
import { TenantService } from "../../../core/services/tenant.service";

@Component({
  selector: "app-mfa",
  imports: [MatSlideToggleModule],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Multi-Factor Authentication</div>
        <div class="ws-subtitle">
          Security policies for {{ tenant.currentTenant().name }}
        </div>
      </div>
    </div>

    <div class="section-card">
      <div class="mfa-list">
        @for (row of rows; track row.id) {
          <div class="mfa-row">
            <div>
              <div class="mfa-label">{{ row.label }}</div>
              <div class="mfa-desc">{{ row.description }}</div>
            </div>
            <mat-slide-toggle
              [checked]="settings().get(row.id) ?? false"
              (change)="toggle(row.id, $event.checked)"
            />
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    .mfa-list {
      display: flex;
      flex-direction: column;
    }
    .mfa-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 16px 0;
      border-bottom: 1px solid var(--border);
    }
    .mfa-row:last-child {
      border-bottom: none;
    }
    .mfa-label {
      font-weight: 600;
    }
    .mfa-desc {
      font-size: 13px;
      color: var(--text3);
      margin-top: 4px;
    }
  `,
})
export class MfaComponent {
  protected readonly tenant = inject(TenantService);

  readonly rows = [
    {
      id: "enforceAdmins",
      label: "Enforce MFA for Admins",
      description: "Require a second factor for users with the Admin role.",
    },
    {
      id: "enforceAll",
      label: "Enforce MFA for All Users",
      description: "Applies to every account in this tenant.",
    },
    {
      id: "backupCodes",
      label: "Allow Backup Codes",
      description: "Let users generate one-time recovery codes.",
    },
    {
      id: "totpRequired",
      label: "TOTP Required",
      description: "Authenticator apps only; SMS and email disabled.",
    },
  ];

  private readonly initialSettings = new Map<string, boolean>([
    ["enforceAdmins", true],
    ["enforceAll", false],
    ["backupCodes", true],
    ["totpRequired", true],
  ]);

  protected readonly settings = signal<Map<string, boolean>>(
    new Map(this.initialSettings),
  );

  protected toggle(id: string, value: boolean): void {
    const next = new Map(this.settings());
    next.set(id, value);
    this.settings.set(next);
  }
}
