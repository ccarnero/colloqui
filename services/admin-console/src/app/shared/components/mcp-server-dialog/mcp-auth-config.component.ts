import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { type FormGroup, ReactiveFormsModule } from "@angular/forms";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import type { McpServerAuthType } from "../../../core/models/agent.model";
import { mcpAuthTypeOptions } from "./mcp-server-dialog.types";

/**
 * Per-type auth fields for an MCP server, sibling to
 * `adapter-auth-config.component.ts` but scoped to none/api-key/bearer/basic
 * — no oauth2 (mcp-connections.md §0.4/§6.4).
 */
@Component({
  selector: "app-mcp-auth-config",
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
        <mat-form-field appearance="outline" class="form-field-full">
          <mat-label>Auth Type</mat-label>
          <mat-select formControlName="type">
            @for (opt of authOptions; track opt.value) {
              <mat-option [value]="opt.value">{{ opt.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        @switch (authType()) {
          @case ("api-key") {
            <div class="form-row">
              <mat-form-field appearance="outline" class="form-field-half">
                <mat-label>Header Name</mat-label>
                <input
                  matInput
                  formControlName="headerName"
                  placeholder="X-Api-Key"
                />
              </mat-form-field>
              <mat-form-field appearance="outline" class="form-field-half">
                <mat-label>API Key</mat-label>
                <input matInput formControlName="key" type="password" />
              </mat-form-field>
            </div>
          }
          @case ("bearer") {
            <mat-form-field appearance="outline" class="form-field-full">
              <mat-label>Token</mat-label>
              <input matInput formControlName="token" type="password" />
            </mat-form-field>
          }
          @case ("basic") {
            <div class="form-row">
              <mat-form-field appearance="outline" class="form-field-half">
                <mat-label>Username</mat-label>
                <input matInput formControlName="username" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="form-field-half">
                <mat-label>Password</mat-label>
                <input matInput formControlName="password" type="password" />
              </mat-form-field>
            </div>
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
  `,
})
export class McpAuthConfigComponent {
  readonly authForm = input.required<FormGroup>();
  readonly authType = input.required<McpServerAuthType>();

  readonly authOptions = mcpAuthTypeOptions();
}
