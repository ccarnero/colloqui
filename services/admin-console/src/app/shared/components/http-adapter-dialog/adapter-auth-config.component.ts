import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { FormGroup, ReactiveFormsModule } from "@angular/forms";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import type { AuthType } from "../../models/http-adapter.model";
import { AUTH_TYPE_LABELS, authTypeOptions } from "./http-adapter-dialog.types";

@Component({
  selector: "app-adapter-auth-config",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  template: `
    <div class="section-card" [formGroup]="authForm()">
      <div class="section-card-header">
        <div class="section-card-title">Authentication</div>
      </div>
      <div class="section-card-body">
        @if (readonly()) {
          <div class="readonly-auth-type">
            {{ authTypeLabel(authType()) }}
          </div>
        } @else {
          <mat-form-field appearance="outline" class="form-field-full">
            <mat-label>Auth Type</mat-label>
            <mat-select formControlName="type">
              @for (opt of authOptions; track opt.value) {
                <mat-option [value]="opt.value">
                  {{ opt.label }}
                </mat-option>
              }
            </mat-select>
          </mat-form-field>
        }

        @switch (authType()) {
          @case ("api-key") {
            <div class="form-row">
              @if (!readonly()) {
                <mat-form-field
                  appearance="outline"
                  class="form-field-half"
                >
                  <mat-label>Header Name</mat-label>
                  <input
                    matInput
                    formControlName="apiKeyHeader"
                    placeholder="X-API-Key"
                  />
                </mat-form-field>
              }
              <mat-form-field
                appearance="outline"
                [class.form-field-half]="!readonly()"
                [class.form-field-full]="readonly()"
              >
                <mat-label>API Key</mat-label>
                <input matInput formControlName="apiKey" type="password" />
              </mat-form-field>
            </div>
          }
          @case ("bearer") {
            <mat-form-field appearance="outline" class="form-field-full">
              <mat-label>API Key</mat-label>
              <input matInput formControlName="bearerToken" type="password" />
            </mat-form-field>
          }
          @case ("basic") {
            <div class="form-row">
              <mat-form-field appearance="outline" class="form-field-half">
                <mat-label>Username</mat-label>
                <input matInput formControlName="basicUsername" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="form-field-half">
                <mat-label>Password</mat-label>
                <input
                  matInput
                  formControlName="basicPassword"
                  type="password"
                />
              </mat-form-field>
            </div>
          }
          @case ("oauth2") {
            <div class="form-row">
              <mat-form-field appearance="outline" class="form-field-half">
                <mat-label>Client ID</mat-label>
                <input matInput formControlName="oauth2ClientId" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="form-field-half">
                <mat-label>Client Secret</mat-label>
                <input
                  matInput
                  formControlName="oauth2ClientSecret"
                  type="password"
                />
              </mat-form-field>
            </div>
            <mat-form-field appearance="outline" class="form-field-full">
              <mat-label>Token URL</mat-label>
              <input
                matInput
                formControlName="oauth2TokenUrl"
                placeholder="https://auth.example.com/oauth/token"
              />
            </mat-form-field>
          }
        }
      </div>
    </div>
  `,
  styles: `
    .section-card-title {
      font-size: 12px;
    }

    .section-card-header {
      padding: 10px 14px;
    }

    .section-card-body {
      padding: 14px;
    }

    .form-row {
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }

    .form-field-half {
      flex: 1;
    }

    .form-field-full {
      width: 100%;
    }

    .readonly-auth-type {
      font-size: 12px;
      color: var(--text2);
      padding: 4px 0 12px;
      font-weight: 500;
    }
  `,
})
export class AdapterAuthConfigComponent {
  readonly authForm = input.required<FormGroup>();
  readonly authType = input.required<AuthType>();
  readonly readonly = input(false);

  readonly authOptions = authTypeOptions();

  authTypeLabel(type: AuthType): string {
    return AUTH_TYPE_LABELS.get(type) ?? type;
  }
}
