import { Component, inject, signal, type OnInit } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { FormsModule } from "@angular/forms";
import { environment } from "../../../environments/environment";
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from "@angular/material/dialog";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";

interface ChannelAccount {
  id: string;
  channel: string;
  provider: string;
  name: string;
  externalId: string;
  phoneNumberId?: string;
  wabaId?: string;
  igUserId?: string;
  accessToken: string;
  appId?: string;
  appSecret?: string;
  verifyToken?: string;
  isActive: boolean;
}

export interface AccountDialogData {
  account?: ChannelAccount;
}

export interface AccountDialogResult {
  saved: boolean;
}

@Component({
  selector: "app-account-dialog",
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
  ],
  template: `
    <div class="dialog-header">
      <div>
        <div class="dialog-title">
          {{ isEdit ? "Edit Account" : "Connect Account" }}
        </div>
        <div class="dialog-subtitle">
          {{
            isEdit
              ? "Update channel account settings"
              : "Connect a WhatsApp or Instagram account"
          }}
        </div>
      </div>
      <button
        type="button"
        class="btn btn-icon btn-secondary"
        aria-label="Close"
        (click)="dialogRef.close()"
      >
        <mat-icon>close</mat-icon>
      </button>
    </div>

    <mat-dialog-content>
      <div class="form-body">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Channel</mat-label>
          <mat-select
            [ngModel]="channel()"
            (ngModelChange)="channel.set($event)"
            [disabled]="isEdit"
          >
            <mat-option value="whatsapp">WhatsApp</mat-option>
            <mat-option value="instagram">Instagram</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Name</mat-label>
          <input
            matInput
            [ngModel]="name()"
            (ngModelChange)="name.set($event)"
            placeholder="e.g. My WhatsApp Business"
          />
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>External ID</mat-label>
          <input
            matInput
            [ngModel]="externalId()"
            (ngModelChange)="externalId.set($event)"
            placeholder="WABA ID or IG User ID"
            [disabled]="isEdit"
          />
        </mat-form-field>

        @if (channel() === "whatsapp") {
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Phone Number ID</mat-label>
            <input
              matInput
              [ngModel]="phoneNumberId()"
              (ngModelChange)="phoneNumberId.set($event)"
            />
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>WABA ID</mat-label>
            <input
              matInput
              [ngModel]="wabaId()"
              (ngModelChange)="wabaId.set($event)"
            />
          </mat-form-field>
        }

        @if (channel() === "instagram") {
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Instagram User ID</mat-label>
            <input
              matInput
              [ngModel]="igUserId()"
              (ngModelChange)="igUserId.set($event)"
            />
          </mat-form-field>
        }

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Access Token</mat-label>
          <input
            matInput
            type="password"
            [ngModel]="accessToken()"
            (ngModelChange)="accessToken.set($event)"
          />
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>App ID (optional)</mat-label>
          <input
            matInput
            [ngModel]="appId()"
            (ngModelChange)="appId.set($event)"
          />
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>App Secret (optional)</mat-label>
          <input
            matInput
            type="password"
            [ngModel]="appSecret()"
            (ngModelChange)="appSecret.set($event)"
          />
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Verify Token (optional)</mat-label>
          <input
            matInput
            [ngModel]="verifyToken()"
            (ngModelChange)="verifyToken.set($event)"
            placeholder="Used for webhook verification"
          />
        </mat-form-field>

        @if (errorMessage()) {
          <div class="error-msg">{{ errorMessage() }}</div>
        }
      </div>
    </mat-dialog-content>

    <div class="dialog-footer">
      <button
        type="button"
        class="btn btn-secondary"
        (click)="dialogRef.close()"
      >
        Cancel
      </button>
      <button
        type="button"
        class="btn btn-primary"
        [disabled]="saving() || !canSave()"
        (click)="save()"
      >
        {{ saving() ? "Saving..." : isEdit ? "Update" : "Connect" }}
      </button>
    </div>
  `,
  styles: `
    .dialog-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      padding: 16px 24px 10px;
      gap: 12px;
    }
    .dialog-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--text);
    }
    .dialog-subtitle {
      font-size: 11px;
      color: var(--text3);
      margin-top: 2px;
    }
    .dialog-footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      padding: 10px 24px 16px;
      border-top: 1px solid var(--border);
    }
    .form-body {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 440px;
    }
    .full-width {
      width: 100%;
    }
    .error-msg {
      color: var(--red);
      font-size: 12px;
      margin-top: 4px;
    }
  `,
})
export class AccountDialogComponent implements OnInit {
  private readonly http = inject(HttpClient);
  readonly dialogRef = inject(
    MatDialogRef<AccountDialogComponent, AccountDialogResult>,
  );
  private readonly data = inject<AccountDialogData>(MAT_DIALOG_DATA);

  isEdit = false;
  private editId = "";

  readonly channel = signal("whatsapp");
  readonly name = signal("");
  readonly externalId = signal("");
  readonly phoneNumberId = signal("");
  readonly wabaId = signal("");
  readonly igUserId = signal("");
  readonly accessToken = signal("");
  readonly appId = signal("");
  readonly appSecret = signal("");
  readonly verifyToken = signal("");
  readonly saving = signal(false);
  readonly errorMessage = signal("");

  ngOnInit(): void {
    const account = this.data.account;
    if (account) {
      this.isEdit = true;
      this.editId = account.id;
      this.channel.set(account.channel);
      this.name.set(account.name);
      this.externalId.set(account.externalId);
      this.phoneNumberId.set(account.phoneNumberId ?? "");
      this.wabaId.set(account.wabaId ?? "");
      this.igUserId.set(account.igUserId ?? "");
      this.accessToken.set(account.accessToken);
      this.appId.set(account.appId ?? "");
      this.appSecret.set(account.appSecret ?? "");
      this.verifyToken.set(account.verifyToken ?? "");
    }
  }

  canSave(): boolean {
    return (
      this.channel().length > 0 &&
      this.name().trim().length > 0 &&
      this.externalId().trim().length > 0 &&
      this.accessToken().trim().length > 0
    );
  }

  save(): void {
    this.saving.set(true);
    this.errorMessage.set("");

    if (this.isEdit) {
      this.http
        .patch(`${environment.apiUrl}/channels/accounts/${this.editId}`, {
          name: this.name().trim(),
          accessToken: this.accessToken().trim(),
          appId: this.appId().trim() || undefined,
          appSecret: this.appSecret().trim() || undefined,
          verifyToken: this.verifyToken().trim() || undefined,
        })
        .subscribe({
          next: () => {
            this.saving.set(false);
            this.dialogRef.close({ saved: true });
          },
          error: (err) => {
            this.saving.set(false);
            this.errorMessage.set(
              err?.error?.message ?? "Failed to update account",
            );
          },
        });
    } else {
      this.http
        .post(`${environment.apiUrl}/channels/accounts`, {
          channel: this.channel(),
          name: this.name().trim(),
          externalId: this.externalId().trim(),
          phoneNumberId: this.phoneNumberId().trim() || undefined,
          wabaId: this.wabaId().trim() || undefined,
          igUserId: this.igUserId().trim() || undefined,
          accessToken: this.accessToken().trim(),
          appId: this.appId().trim() || undefined,
          appSecret: this.appSecret().trim() || undefined,
          verifyToken: this.verifyToken().trim() || undefined,
        })
        .subscribe({
          next: () => {
            this.saving.set(false);
            this.dialogRef.close({ saved: true });
          },
          error: (err) => {
            this.saving.set(false);
            this.errorMessage.set(
              err?.error?.message ?? "Failed to create account",
            );
          },
        });
    }
  }
}
