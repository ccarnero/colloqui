import { ChangeDetectionStrategy, Component, model } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSlideToggleModule } from "@angular/material/slide-toggle";

@Component({
  selector: "app-customization",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule,
  ],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Customization</div>
        <div class="ws-subtitle">
          Branding, domain, and feature toggles for your workspace
        </div>
      </div>
    </div>

    <div class="section-card">
      <div class="section-card-header">
        <div class="section-card-title">Branding</div>
      </div>
      <div class="section-card-body form-grid">
        <mat-form-field appearance="outline">
          <mat-label>Brand Name</mat-label>
          <input matInput [(ngModel)]="brandName" name="brandName" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Primary Color</mat-label>
          <input matInput [(ngModel)]="primaryColor" name="primaryColor" />
        </mat-form-field>
        <mat-form-field appearance="outline" class="span-2">
          <mat-label>Logo URL</mat-label>
          <input matInput [(ngModel)]="logoUrl" name="logoUrl" />
        </mat-form-field>
        <mat-form-field appearance="outline" class="span-2">
          <mat-label>Custom Domain</mat-label>
          <input matInput [(ngModel)]="customDomain" name="customDomain" />
        </mat-form-field>
      </div>
    </div>

    <div class="section-card" style="margin-top: 16px">
      <div class="section-card-header">
        <div class="section-card-title">Features</div>
      </div>
      <div class="section-card-body toggle-list">
        @for (row of featureRows; track row.key) {
          <div class="toggle-row">
            <div>
              <div class="toggle-title">{{ row.title }}</div>
              <div class="toggle-desc">{{ row.description }}</div>
            </div>
            <mat-slide-toggle
              [(ngModel)]="row.enabled"
              [name]="row.key"
              color="primary"
            />
          </div>
        }
      </div>
    </div>

    <div class="actions">
      <button class="btn btn-secondary btn-sm" type="button">Reset</button>
      <button class="btn btn-primary btn-sm" type="button">Save changes</button>
    </div>
  `,
  styles: `
    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px 16px;
    }
    .span-2 {
      grid-column: span 2;
    }
    @media (max-width: 720px) {
      .form-grid {
        grid-template-columns: 1fr;
      }
      .span-2 {
        grid-column: span 1;
      }
    }
    .toggle-list {
      display: flex;
      flex-direction: column;
      gap: 0;
    }
    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 0;
      border-bottom: 1px solid var(--border);
    }
    .toggle-row:last-child {
      border-bottom: none;
    }
    .toggle-title {
      font-size: 13px;
      font-weight: 600;
    }
    .toggle-desc {
      font-size: 12px;
      color: var(--text3);
      margin-top: 2px;
    }
    .actions {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      margin-top: 16px;
    }
  `,
})
export class CustomizationComponent {
  readonly brandName = model("Acme Platform");
  readonly primaryColor = model("#6366f1");
  readonly logoUrl = model("https://cdn.example.com/brands/acme-logo.svg");
  readonly customDomain = model("app.acme.example.com");

  readonly featureRows = [
    {
      key: "sso",
      title: "SSO / SAML",
      description: "Allow enterprise IdP sign-in for your organization",
      enabled: true,
    },
    {
      key: "customBranding",
      title: "Custom branding",
      description: "Apply logo and colors across the admin experience",
      enabled: true,
    },
    {
      key: "auditExport",
      title: "Audit log export",
      description: "Enable scheduled exports to your SIEM or storage",
      enabled: false,
    },
    {
      key: "betaUi",
      title: "Beta UI",
      description: "Opt in to upcoming interface experiments",
      enabled: false,
    },
  ];
}
