import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  signal,
  OnInit,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { MatTooltipModule } from "@angular/material/tooltip";
import { MatChipsModule } from "@angular/material/chips";
import { YoizenclawAdminService } from "../../../core/services/yoizenclaw-admin.service";
import {
  type IYoizenclawCredentialProfile,
  type IYoizenclawCreateCredentialPayload,
  type IYoizenclawUpdateCredentialPayload,
  type IYoizenclawProviderSchema,
  type IYoizenclawProviderField,
  type YoizenclawCredentialProvider,
  type YoizenclawCredentialSyncStatus,
  YOIZENCLAW_CREDENTIAL_PROVIDERS,
  YOIZENCLAW_PROVIDER_DISPLAY_NAMES,
} from "../../../core/models/yoizenclaw.model";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";

// ============================================================================
// Provider-Aware Credential Dialog Component (Create/Edit)
// ============================================================================

interface CredentialDialogData {
  credential?: IYoizenclawCredentialProfile;
  providers: IYoizenclawProviderSchema[];
}

interface CredentialDialogResult {
  saved: boolean;
  credential?: IYoizenclawCredentialProfile;
}

@Component({
  selector: "app-credential-dialog",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
  ],
  template: `
    <div class="dialog-header">
      <h2>{{ isEdit ? "Edit Credential" : "Create Credential" }}</h2>
    </div>

    <mat-dialog-content>
      <!-- Provider Selection (only for create) -->
      @if (!isEdit) {
        <div class="form-group">
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Provider</mat-label>
            <mat-select [ngModel]="selectedProvider()" (ngModelChange)="selectedProvider.set($event); onProviderChange()" required>
              @for (provider of availableProviders(); track provider.provider) {
                <mat-option [value]="provider.provider">
                  <div class="provider-option">
                    <span class="provider-name">{{ provider.display_name }}</span>
                    <span class="provider-description">{{ provider.description }}</span>
                  </div>
                </mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>
      } @else {
        <div class="form-group">
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Provider</mat-label>
            <input matInput [value]="getProviderDisplayName(credential?.provider)" disabled />
          </mat-form-field>
        </div>
      }

      <!-- Credential Name -->
      <div class="form-group">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Name</mat-label>
          <input matInput [(ngModel)]="name" required placeholder="e.g., Production OpenAI Key" />
        </mat-form-field>
      </div>

      <!-- Dynamic Provider Fields -->
      @if (currentSchema(); as schema) {
        <div class="provider-fields">
          <h4>Provider Configuration</h4>
          
          @for (field of schema.fields; track field.name) {
            <div class="form-group">
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>{{ field.description }}</mat-label>
                
                @if (field.secret) {
                  <!-- Secret field with masking and replace toggle -->
                  @if (isEditingSecret(field.name)) {
                    <input
                      matInput
                      [type]="showSecretFields()[field.name] ? 'text' : 'password'"
                      [ngModel]="getPayloadValue(field.name)"
                      (ngModelChange)="setPayloadValue(field.name, $event)"
                      [required]="field.required && (!isEdit || !credential?.has_secret)"
                      [placeholder]="field.placeholder || ''"
                    />
                    <button
                      mat-icon-button
                      matSuffix
                      (click)="toggleShowSecret(field.name)"
                      type="button"
                      [matTooltip]="showSecretFields()[field.name] ? 'Hide' : 'Show'"
                    >
                      <mat-icon>{{ showSecretFields()[field.name] ? 'visibility_off' : 'visibility' }}</mat-icon>
                    </button>
                  } @else {
                    <input matInput value="••••••••••••" disabled />
                    <button
                      mat-button
                      matSuffix
                      (click)="enableSecretEdit(field.name)"
                      type="button"
                    >
                      Replace
                    </button>
                  }
                } @else {
                  <!-- Non-secret field -->
                  <input
                    matInput
                    [type]="field.type === 'url' ? 'url' : 'text'"
                    [ngModel]="getPayloadValue(field.name)"
                    (ngModelChange)="setPayloadValue(field.name, $event)"
                    [required]="field.required"
                    [placeholder]="field.placeholder || ''"
                  />
                }
                
                @if (field.type === 'json') {
                  <mat-hint>Enter valid JSON</mat-hint>
                }
              </mat-form-field>
            </div>
          }
        </div>
      }

      <!-- Expiration -->
      <div class="form-group">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Expires At (Optional)</mat-label>
          <input matInput type="datetime-local" [(ngModel)]="expiresAt" />
        </mat-form-field>
      </div>

      <!-- Active Status -->
      <div class="form-group">
        <mat-checkbox [(ngModel)]="isActive">Active</mat-checkbox>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        color="primary"
        (click)="save()"
        [disabled]="saving() || !isFormValid()"
      >
        {{ saving() ? "Saving..." : isEdit ? "Update" : "Create" }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .dialog-header {
      margin-bottom: 20px;
      h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
      }
    }

    mat-dialog-content {
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-width: 100%;
      max-height: 70vh;
      overflow-y: auto;
    }

    .form-group {
      display: flex;
      flex-direction: column;
    }

    .full-width {
      width: 100%;
    }

    mat-form-field {
      width: 100%;
    }

    mat-dialog-actions {
      margin-top: 24px;
      gap: 8px;
    }

    .provider-fields {
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius);
      padding: 16px;
      background: var(--bg2);

      h4 {
        margin: 0 0 16px 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--text);
      }
    }

    .provider-option {
      display: flex;
      flex-direction: column;
      
      .provider-name {
        font-weight: 500;
      }
      
      .provider-description {
        font-size: 12px;
        color: var(--text2);
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class CredentialDialogComponent implements OnInit {
  private readonly dialogRef = inject<MatDialogRef<
    CredentialDialogComponent,
    CredentialDialogResult
  >>(MatDialogRef);
  public readonly data = inject<CredentialDialogData>(MAT_DIALOG_DATA);
  private readonly service = inject(YoizenclawAdminService);

  readonly saving = signal(false);
  readonly showSecretFields = signal<Record<string, boolean>>({});
  readonly editingSecrets = signal<Record<string, boolean>>({});

  isEdit = false;
  credential?: IYoizenclawCredentialProfile;
  name = "";
  readonly selectedProvider = signal<YoizenclawCredentialProvider | "">("");
  expiresAt = "";
  isActive = true;
  payload: Record<string, unknown> = {};

  readonly availableProviders = computed(() => this.data.providers);

  readonly currentSchema = computed(() => {
    const provider = this.selectedProvider();
    if (!provider) return null;
    return this.data.providers.find(p => p.provider === provider) || null;
  });

  ngOnInit(): void {
    if (this.data.credential) {
      this.isEdit = true;
      this.credential = this.data.credential;
      this.name = this.data.credential.name;
      this.selectedProvider.set(this.data.credential.provider);
      this.expiresAt = this.data.credential.expires_at || "";
      this.isActive = this.data.credential.is_active;
      this.payload = { ...this.data.credential.payload };
    }
  }

  onProviderChange(): void {
    // Reset payload when provider changes
    this.payload = {};
    this.editingSecrets.set({});
  }

  getProviderDisplayName(provider?: YoizenclawCredentialProvider): string {
    if (!provider) return "";
    return YOIZENCLAW_PROVIDER_DISPLAY_NAMES[provider] || provider;
  }

  getPayloadValue(fieldName: string): string {
    const value = this.payload[fieldName];
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  }

  setPayloadValue(fieldName: string, value: string): void {
    const schema = this.currentSchema();
    if (!schema) return;

    const field = schema.fields.find(f => f.name === fieldName);
    if (!field) return;

    if (field.type === "json" && value) {
      try {
        this.payload[fieldName] = JSON.parse(value);
      } catch {
        // Keep as string if invalid JSON
        this.payload[fieldName] = value;
      }
    } else {
      this.payload[fieldName] = value;
    }
  }

  isEditingSecret(fieldName: string): boolean {
    // In create mode, always show the field
    if (!this.isEdit) return true;
    // In edit mode, only show if explicitly editing
    return this.editingSecrets()[fieldName] || false;
  }

  enableSecretEdit(fieldName: string): void {
    this.editingSecrets.update(current => ({ ...current, [fieldName]: true }));
    this.payload[fieldName] = ""; // Clear the masked value
  }

  toggleShowSecret(fieldName: string): void {
    this.showSecretFields.update(current => ({
      ...current,
      [fieldName]: !current[fieldName],
    }));
  }

  isFormValid(): boolean {
    if (!this.name.trim()) return false;
    if (!this.selectedProvider()) return false;

    const schema = this.currentSchema();
    if (!schema) return false;

    // Check required fields
    for (const field of schema.fields) {
      if (field.required) {
        const value = this.payload[field.name];
        if (field.secret && this.isEdit && !this.editingSecrets()[field.name]) {
          // In edit mode, existing secrets are preserved if not editing
          continue;
        }
        if (value === undefined || value === null || value === "") {
          return false;
        }
      }
    }

    return true;
  }

  save(): void {
    if (!this.isFormValid()) return;

    this.saving.set(true);

    const payload = this.isEdit
      ? ({
          name: this.name,
          payload: this.payload,
          ...(this.expiresAt ? { expires_at: this.expiresAt } : {}),
          is_active: this.isActive,
        } as IYoizenclawUpdateCredentialPayload)
      : ({
          name: this.name,
          provider: this.selectedProvider() as YoizenclawCredentialProvider,
          payload: this.payload,
          ...(this.expiresAt ? { expires_at: this.expiresAt } : {}),
          is_active: this.isActive,
        } as IYoizenclawCreateCredentialPayload);

    const operation = this.isEdit
      ? this.service.updateCredentialProfile(this.credential!.id, payload as IYoizenclawUpdateCredentialPayload)
      : this.service.createCredentialProfile(payload as IYoizenclawCreateCredentialPayload);

    operation.subscribe({
      next: (credential) => {
        this.saving.set(false);
        this.dialogRef.close({ saved: true, credential });
      },
      error: () => {
        this.saving.set(false);
      },
    });
  }
}

// ============================================================================
// Rotate Dialog Component (Provider-Aware)
// ============================================================================

interface RotateDialogData {
  credentialId: string;
  credentialName: string;
  provider: YoizenclawCredentialProvider;
  providers: IYoizenclawProviderSchema[];
}

interface RotateDialogResult {
  rotated: boolean;
}

@Component({
  selector: "app-rotate-dialog",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
  ],
  template: `
    <div class="dialog-header">
      <h2>Rotate Credential: {{ data.credentialName }}</h2>
    </div>

    <mat-dialog-content>
      <div class="info-text">
        Enter new values for all secret fields. Non-secret fields will be preserved.
      </div>

      @if (schema(); as providerSchema) {
        @for (field of providerSchema.fields; track field.name) {
          @if (field.secret) {
            <div class="form-group">
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>{{ field.description }}</mat-label>
                <input
                  matInput
                  [type]="showSecrets()[field.name] ? 'text' : 'password'"
                  [ngModel]="getPayloadValue(field.name)"
                  (ngModelChange)="setPayloadValue(field.name, $event)"
                  [required]="field.required"
                  [placeholder]="field.placeholder || 'Enter new ' + field.name"
                />
                <button
                  mat-icon-button
                  matSuffix
                  (click)="toggleShowSecret(field.name)"
                  type="button"
                  [matTooltip]="showSecrets()[field.name] ? 'Hide' : 'Show'"
                >
                  <mat-icon>{{ showSecrets()[field.name] ? 'visibility_off' : 'visibility' }}</mat-icon>
                </button>
              </mat-form-field>
            </div>
          }
        }
      }

      <div class="form-group">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>New Expiration (Optional)</mat-label>
          <input matInput type="datetime-local" [(ngModel)]="newExpiresAt" />
        </mat-form-field>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        color="primary"
        (click)="rotate()"
        [disabled]="saving() || !isFormValid()"
      >
        {{ saving() ? "Rotating..." : "Rotate" }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .dialog-header {
      margin-bottom: 20px;
      h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
      }
    }

    .info-text {
      padding: 12px;
      background: var(--accent-dim);
      border-radius: var(--radius);
      margin-bottom: 16px;
      font-size: 13px;
      color: var(--text2);
    }

    mat-dialog-content {
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-width: 100%;
    }

    .form-group {
      display: flex;
      flex-direction: column;
    }

    .full-width {
      width: 100%;
    }

    mat-form-field {
      width: 100%;
    }

    mat-dialog-actions {
      margin-top: 24px;
      gap: 8px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class RotateDialogComponent implements OnInit {
  private readonly dialogRef = inject<MatDialogRef<
    RotateDialogComponent,
    RotateDialogResult
  >>(MatDialogRef);
  public readonly data = inject<RotateDialogData>(MAT_DIALOG_DATA);
  private readonly service = inject(YoizenclawAdminService);

  readonly saving = signal(false);
  readonly showSecrets = signal<Record<string, boolean>>({});

  newExpiresAt = "";
  payload: Record<string, unknown> = {};

  readonly schema = computed(() => {
    return this.data.providers.find(p => p.provider === this.data.provider) || null;
  });

  ngOnInit(): void {
    // Pre-fill with empty values for all secret fields
    const providerSchema = this.schema();
    if (providerSchema) {
      for (const field of providerSchema.fields) {
        if (field.secret) {
          this.payload[field.name] = "";
        }
      }
    }
  }

  getPayloadValue(fieldName: string): string {
    const value = this.payload[fieldName];
    return typeof value === "string" ? value : "";
  }

  setPayloadValue(fieldName: string, value: string): void {
    this.payload[fieldName] = value;
  }

  toggleShowSecret(fieldName: string): void {
    this.showSecrets.update(current => ({
      ...current,
      [fieldName]: !current[fieldName],
    }));
  }

  isFormValid(): boolean {
    const providerSchema = this.schema();
    if (!providerSchema) return false;

    // All required secret fields must have values
    for (const field of providerSchema.fields) {
      if (field.secret && field.required) {
        const value = this.payload[field.name];
        if (!value || (typeof value === "string" && !value.trim())) {
          return false;
        }
      }
    }

    return true;
  }

  rotate(): void {
    if (!this.isFormValid()) return;

    this.saving.set(true);

    this.service
      .rotateCredentialProfile(this.data.credentialId, {
        payload: this.payload,
        ...(this.newExpiresAt ? { new_expires_at: this.newExpiresAt } : {}),
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.dialogRef.close({ rotated: true });
        },
        error: () => {
          this.saving.set(false);
        },
      });
  }
}

// ============================================================================
// Main Credentials List Component
// ============================================================================

@Component({
  selector: "app-yoizenclaw-credentials",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatSelectModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatTooltipModule,
  ],
  template: `
    <div class="ws-header">
      <h1 class="ws-title">Credentials</h1>
      <div class="ws-actions">
        <button
          class="btn btn-secondary"
          (click)="syncCredentials()"
          [disabled]="syncing() || loading()"
        >
          <mat-icon>sync</mat-icon>
          {{ syncing() ? "Syncing..." : "Sync to Runtime" }}
        </button>
        <button
          class="btn btn-primary"
          (click)="openCreateDialog()"
          [disabled]="loading() || providers().length === 0"
        >
          <mat-icon>add</mat-icon>
          New Credential
        </button>
      </div>
    </div>

    @if (errorMessage()) {
      <div class="alert alert-error">
        {{ errorMessage() }}
      </div>
    }

    @if (successMessage()) {
      <div class="alert alert-success">
        {{ successMessage() }}
      </div>
    }

    <div class="section-card">
      <div class="section-card-header">
        <h3 class="section-card-title">Credential Profiles</h3>
        <div class="filter-controls">
          <select
            [(ngModel)]="filterProvider"
            (change)="loadCredentials()"
            class="filter-select"
          >
            <option value="">All Providers</option>
            @for (provider of YOIZENCLAW_CREDENTIAL_PROVIDERS; track provider) {
              <option [value]="provider">{{ getProviderDisplayName(provider) }}</option>
            }
          </select>
          
          <select
            [(ngModel)]="filterSyncStatus"
            (change)="loadCredentials()"
            class="filter-select"
          >
            <option value="">All Statuses</option>
            <option value="synced">Synced</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
            <option value="manual_review_required">Needs Review</option>
          </select>
        </div>
      </div>

      <div class="section-card-body">
        @if (loading()) {
          <div class="loading-container">
            <mat-spinner diameter="40"></mat-spinner>
            <p>Loading credentials...</p>
          </div>
        } @else if (credentials().length === 0) {
          <div class="empty-state">
            <mat-icon>lock_outline</mat-icon>
            <p>No credentials found</p>
          </div>
        } @else {
          <table class="credentials-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Provider</th>
                <th>Sync Status</th>
                <th>Status</th>
                <th>Expires</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (cred of credentials(); track cred.id) {
                <tr>
                  <td class="name-cell">
                    {{ cred.name }}
                  </td>
                  <td>
                    <span class="badge badge-provider">
                      {{ getProviderDisplayName(cred.provider) }}
                    </span>
                  </td>
                  <td>
                    <span
                      class="badge"
                      [class.badge-green]="cred.sync_status === 'synced'"
                      [class.badge-yellow]="cred.sync_status === 'pending'"
                      [class.badge-red]="cred.sync_status === 'failed'"
                      [class.badge-gray]="cred.sync_status === 'manual_review_required'"
                      [matTooltip]="cred.sync_error || ''"
                    >
                      <mat-icon class="status-icon">
                        {{ getSyncStatusIcon(cred.sync_status) }}
                      </mat-icon>
                      {{ formatSyncStatus(cred.sync_status) }}
                    </span>
                  </td>
                  <td>
                    <span
                      class="badge"
                      [class.badge-green]="cred.is_active"
                      [class.badge-gray]="!cred.is_active"
                    >
                      {{ cred.is_active ? "Active" : "Inactive" }}
                    </span>
                  </td>
                  <td>
                    @if (cred.expires_at) {
                      <span
                        class="badge"
                        [class.badge-red]="isExpired(cred.expires_at)"
                        [class.badge-blue]="!isExpired(cred.expires_at)"
                      >
                        {{ isExpired(cred.expires_at) ? "Expired" : formatDate(cred.expires_at) }}
                      </span>
                    } @else {
                      <span class="text3">—</span>
                    }
                  </td>
                  <td class="date-cell">
                    {{ formatDate(cred.created_at) }}
                  </td>
                  <td class="actions-cell">
                    <button
                      mat-icon-button
                      (click)="openEditDialog(cred)"
                      matTooltip="Edit"
                      [disabled]="loading()"
                    >
                      <mat-icon>edit</mat-icon>
                    </button>
                    <button
                      mat-icon-button
                      (click)="openRotateDialog(cred)"
                      matTooltip="Rotate secrets"
                      [disabled]="loading()"
                    >
                      <mat-icon>refresh</mat-icon>
                    </button>
                    <button
                      mat-icon-button
                      (click)="deleteCredential(cred.id)"
                      matTooltip="Delete"
                      [disabled]="loading()"
                      class="btn-danger"
                    >
                      <mat-icon>delete</mat-icon>
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
    </div>
  `,
  styles: `
    .ws-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;

      .ws-title {
        margin: 0;
        font-size: 24px;
        font-weight: 600;
      }

      .ws-actions {
        display: flex;
        gap: 12px;
      }
    }

    .alert {
      padding: 12px 16px;
      border-radius: var(--radius2);
      margin-bottom: 16px;
      font-size: 14px;

      &.alert-error {
        background-color: var(--red-dim);
        color: #d32f2f;
        border: 1px solid #ef5350;
      }

      &.alert-success {
        background-color: var(--green-dim);
        color: #388e3c;
        border: 1px solid #66bb6a;
      }
    }

    .section-card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius2);
      box-shadow: var(--shadow);
    }

    .section-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px;
      border-bottom: 1px solid var(--border-subtle);
      gap: 16px;

      .section-card-title {
        margin: 0;
        font-size: 13px;
        font-weight: 700;
        text-transform: uppercase;
        color: var(--primary);
      }

      .filter-controls {
        display: flex;
        gap: 12px;

        .filter-select {
          padding: 8px 12px;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius);
          background: var(--bg);
          color: var(--text);
          font-size: 13px;
          cursor: pointer;

          &:focus {
            outline: none;
            border-color: var(--primary);
          }
        }
      }
    }

    .section-card-body {
      padding: 16px;
    }

    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 16px;
      gap: 16px;
      color: var(--text2);

      p {
        margin: 0;
        font-size: 14px;
      }
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 16px;
      color: var(--text2);

      mat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        margin-bottom: 16px;
        opacity: 0.5;
      }

      p {
        margin: 0;
        font-size: 14px;
      }
    }

    .credentials-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;

      thead {
        background: var(--bg2);

        th {
          padding: 12px 16px;
          text-align: left;
          font-weight: 600;
          color: var(--text);
          border-bottom: 1px solid var(--border-subtle);
        }
      }

      tbody {
        tr {
          border-bottom: 1px solid var(--border-subtle);

          &:hover {
            background: var(--bg2);
          }

          td {
            padding: 12px 16px;
            color: var(--text);
          }
        }
      }
    }

    .name-cell {
      font-weight: 500;
    }

    .date-cell {
      color: var(--text3);
      font-size: 12px;
    }

    .actions-cell {
      display: flex;
      gap: 4px;

      button {
        &.btn-danger:hover {
          color: #d32f2f;
        }
      }
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: var(--radius);
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;

      &.badge-provider {
        background: var(--purple-dim);
        color: #6a1b9a;
      }

      &.badge-blue {
        background: var(--accent-dim);
        color: var(--primary);
      }

      &.badge-gray {
        background: rgba(0, 0, 0, 0.06);
        color: var(--text2);
      }

      &.badge-green {
        background: var(--green-dim);
        color: #388e3c;
      }

      &.badge-red {
        background: var(--red-dim);
        color: #d32f2f;
      }

      &.badge-yellow {
        background: var(--yellow-dim, rgba(255, 193, 7, 0.2));
        color: #f57c00;
      }

      .status-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
      }
    }

    .text3 {
      color: var(--text3);
    }

    .btn {
      padding: 8px 16px;
      border: none;
      border-radius: var(--radius);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s;

      &.btn-primary {
        background: var(--primary);
        color: white;

        &:hover:not(:disabled) {
          opacity: 0.9;
        }

        &:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      }

      &.btn-secondary {
        background: var(--bg2);
        color: var(--text);
        border: 1px solid var(--border-subtle);

        &:hover:not(:disabled) {
          background: var(--bg);
        }

        &:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class YoizenclawCredentialsComponent implements OnInit {
  private readonly service = inject(YoizenclawAdminService);
  private readonly dialog = inject(MatDialog);

  readonly credentials = signal<IYoizenclawCredentialProfile[]>([]);
  readonly providers = signal<IYoizenclawProviderSchema[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly syncing = signal(false);
  readonly errorMessage = signal("");
  readonly successMessage = signal("");
  readonly filterProvider = signal<YoizenclawCredentialProvider | "">("");
  readonly filterSyncStatus = signal<YoizenclawCredentialSyncStatus | "">("");

  readonly YOIZENCLAW_CREDENTIAL_PROVIDERS = YOIZENCLAW_CREDENTIAL_PROVIDERS;

  ngOnInit(): void {
    this.loadProviders();
    this.loadCredentials();
  }

  loadProviders(): void {
    this.service.listCredentialProviders().subscribe({
      next: (response) => {
        this.providers.set(response.providers);
      },
      error: () => {
        // Silent fail - providers not critical for list view
      },
    });
  }

  loadCredentials(): void {
    this.loading.set(true);
    this.errorMessage.set("");
    this.successMessage.set("");

    this.service
      .listCredentialProfiles({
        provider: this.filterProvider() || undefined,
        sync_status: this.filterSyncStatus() || undefined,
      })
      .subscribe({
        next: (response) => {
          this.credentials.set(response.credentials);
          this.total.set(response.total);
          this.loading.set(false);
        },
        error: (error: { error?: { message?: string | string[] } }) => {
          const message = error.error?.message;
          this.errorMessage.set(
            Array.isArray(message)
              ? message.join(", ")
              : message ?? "Failed to load credentials"
          );
          this.loading.set(false);
        },
      });
  }

  syncCredentials(): void {
    this.syncing.set(true);
    this.errorMessage.set("");
    this.successMessage.set("");

    this.service.syncCredentials().subscribe({
      next: (response) => {
        this.syncing.set(false);
        this.successMessage.set(
          `Sync completed: ${response.summary.successful} successful, ${response.summary.failed} failed`
        );
        this.loadCredentials(); // Refresh to show updated sync status
        setTimeout(() => this.successMessage.set(""), 5000);
      },
      error: (error: { error?: { message?: string | string[] } }) => {
        this.syncing.set(false);
        const message = error.error?.message;
        this.errorMessage.set(
          Array.isArray(message)
            ? message.join(", ")
            : message ?? "Failed to sync credentials"
        );
      },
    });
  }

  openCreateDialog(): void {
    const ref = this.dialog.open(CredentialDialogComponent, {
      width: "600px",
      maxHeight: "90vh",
      data: { providers: this.providers() },
    });

    ref.afterClosed().subscribe((result?: CredentialDialogResult) => {
      if (result?.saved) {
        this.successMessage.set("Credential created successfully");
        this.loadCredentials();
        setTimeout(() => this.successMessage.set(""), 4000);
      }
    });
  }

  openEditDialog(credential: IYoizenclawCredentialProfile): void {
    const ref = this.dialog.open(CredentialDialogComponent, {
      width: "600px",
      maxHeight: "90vh",
      data: { credential, providers: this.providers() },
    });

    ref.afterClosed().subscribe((result?: CredentialDialogResult) => {
      if (result?.saved) {
        this.successMessage.set("Credential updated successfully");
        this.loadCredentials();
        setTimeout(() => this.successMessage.set(""), 4000);
      }
    });
  }

  openRotateDialog(credential: IYoizenclawCredentialProfile): void {
    const ref = this.dialog.open(RotateDialogComponent, {
      width: "540px",
      data: {
        credentialId: credential.id,
        credentialName: credential.name,
        provider: credential.provider,
        providers: this.providers(),
      },
    });

    ref.afterClosed().subscribe((result?: RotateDialogResult) => {
      if (result?.rotated) {
        this.successMessage.set("Credential rotated successfully");
        this.loadCredentials();
        setTimeout(() => this.successMessage.set(""), 4000);
      }
    });
  }

  deleteCredential(id: string): void {
    const credential = this.credentials().find((c) => c.id === id);
    if (!credential) return;

    if (confirm(`Delete credential "${credential.name}"?`)) {
      this.loading.set(true);
      this.service.deleteCredentialProfile(id).subscribe({
        next: () => {
          this.successMessage.set("Credential deleted successfully");
          this.loadCredentials();
          setTimeout(() => this.successMessage.set(""), 4000);
        },
        error: (error: { error?: { message?: string | string[] } }) => {
          const message = error.error?.message;
          this.errorMessage.set(
            Array.isArray(message)
              ? message.join(", ")
              : message ?? "Failed to delete credential"
          );
          this.loading.set(false);
        },
      });
    }
  }

  getProviderDisplayName(provider: YoizenclawCredentialProvider): string {
    return YOIZENCLAW_PROVIDER_DISPLAY_NAMES[provider] || provider;
  }

  formatSyncStatus(status: YoizenclawCredentialSyncStatus): string {
    const map: Record<YoizenclawCredentialSyncStatus, string> = {
      synced: "Synced",
      pending: "Pending",
      failed: "Failed",
      manual_review_required: "Needs Review",
    };
    return map[status] || status;
  }

  getSyncStatusIcon(status: YoizenclawCredentialSyncStatus): string {
    const map: Record<YoizenclawCredentialSyncStatus, string> = {
      synced: "check_circle",
      pending: "schedule",
      failed: "error",
      manual_review_required: "help",
    };
    return map[status] || "help";
  }

  isExpired(expiresAt: string): boolean {
    return new Date(expiresAt) < new Date();
  }

  formatDate(date: string): string {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}
