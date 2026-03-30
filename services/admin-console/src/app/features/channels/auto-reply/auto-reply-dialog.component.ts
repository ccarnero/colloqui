import { Component, inject, signal, type OnInit } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { FormsModule } from "@angular/forms";
import { environment } from "../../../../environments/environment";
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
  name: string;
}

export interface AutoReplyDialogData {}

export interface AutoReplyDialogResult {
  saved: boolean;
}

@Component({
  selector: "app-auto-reply-dialog",
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
        <div class="dialog-title">Add Auto-Reply Rule</div>
        <div class="dialog-subtitle">
          Configure an automatic response for incoming messages
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
          <mat-label>Account</mat-label>
          <mat-select
            [ngModel]="selectedAccountId()"
            (ngModelChange)="onAccountChange($event)"
          >
            @for (a of accounts(); track a.id) {
              <mat-option [value]="a.id">
                {{ a.name }} ({{ a.channel }})
              </mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Channel</mat-label>
          <input matInput [ngModel]="selectedChannel()" disabled />
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Trigger Pattern</mat-label>
          <input
            matInput
            [ngModel]="triggerPattern()"
            (ngModelChange)="triggerPattern.set($event)"
            placeholder='e.g. ping, *, regex:^(hi|hello)'
          />
          <mat-hint>
            Use * to match all messages, or regex: prefix for regex
          </mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Reply Text</mat-label>
          <textarea
            matInput
            [ngModel]="replyText()"
            (ngModelChange)="replyText.set($event)"
            rows="3"
            placeholder="The automatic reply message"
          ></textarea>
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
        {{ saving() ? "Saving..." : "Create" }}
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
export class AutoReplyDialogComponent implements OnInit {
  private readonly http = inject(HttpClient);
  readonly dialogRef = inject(
    MatDialogRef<AutoReplyDialogComponent, AutoReplyDialogResult>,
  );
  private readonly data = inject<AutoReplyDialogData>(MAT_DIALOG_DATA);

  readonly accounts = signal<ChannelAccount[]>([]);
  readonly selectedAccountId = signal("");
  readonly selectedChannel = signal("");
  readonly triggerPattern = signal("");
  readonly replyText = signal("");
  readonly saving = signal(false);
  readonly errorMessage = signal("");

  ngOnInit(): void {
    this.http.get<ChannelAccount[]>(`${environment.apiUrl}/channels/accounts`).subscribe({
      next: (list) => {
        this.accounts.set(list);
        if (list.length > 0) {
          this.selectedAccountId.set(list[0].id);
          this.selectedChannel.set(list[0].channel);
        }
      },
    });
  }

  onAccountChange(accountId: string): void {
    this.selectedAccountId.set(accountId);
    const account = this.accounts().find((a) => a.id === accountId);
    this.selectedChannel.set(account?.channel ?? "");
  }

  canSave(): boolean {
    return (
      this.selectedAccountId().length > 0 &&
      this.triggerPattern().trim().length > 0 &&
      this.replyText().trim().length > 0
    );
  }

  save(): void {
    this.saving.set(true);
    this.errorMessage.set("");

    this.http
      .post(`${environment.apiUrl}/channels/auto-reply`, {
        accountId: this.selectedAccountId(),
        channel: this.selectedChannel(),
        triggerPattern: this.triggerPattern().trim(),
        replyText: this.replyText().trim(),
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.dialogRef.close({ saved: true });
        },
        error: (err) => {
          this.saving.set(false);
          this.errorMessage.set(
            err?.error?.message ?? "Failed to create rule",
          );
        },
      });
  }
}
