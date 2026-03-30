import { Component, inject, signal, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatButtonModule } from "@angular/material/button";
import { MatSelectModule } from "@angular/material/select";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { MatTabsModule } from "@angular/material/tabs";
import {
  LucideAngularModule,
  Send,
  FileText,
  CheckCircle,
  AlertCircle,
} from "lucide-angular";
import {
  ChannelService,
  IChannelAccount,
  ISendMessageDto,
} from "../../core/services/channel.service";

@Component({
  selector: "app-message-composer",
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    LucideAngularModule,
  ],
  template: `
    <div class="composer-page">
      <div class="ws-header">
        <div>
          <h1 class="ws-title">Send Message</h1>
          <p class="ws-subtitle">
            Send a text or template message through a connected account
          </p>
        </div>
      </div>

      @if (result()) {
        <div class="alert"
             [class.alert-info]="result()!.type === 'ok'"
             [class.alert-error]="result()!.type === 'error'">
          @if (result()!.type === "ok") {
            <lucide-icon [img]="CheckCircle" [size]="16" />
          } @else {
            <lucide-icon [img]="AlertCircle" [size]="16" />
          }
          {{ result()!.text }}
        </div>
      }

      <!-- Account selector -->
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Account</mat-label>
        <mat-select [(ngModel)]="selectedAccountId" name="account">
          @for (acct of accounts(); track acct.id) {
            <mat-option [value]="acct.id">
              {{ acct.name || acct.id }}
              ({{ acct.channel }})
            </mat-option>
          }
        </mat-select>
      </mat-form-field>

      <mat-tab-group (selectedTabChange)="onTabChange($event)">
        <!-- Text message tab -->
        <mat-tab label="Text Message">
          <div class="tab-body">
            <form (ngSubmit)="sendText()" class="msg-form">
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>{{ recipientLabel }}</mat-label>
                <input matInput
                       [(ngModel)]="recipient"
                       name="recipient"
                       required
                       [placeholder]="recipientPlaceholder" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Message</mat-label>
                <textarea matInput
                          [(ngModel)]="textMessage"
                          name="textMessage"
                          required
                          rows="4"
                          placeholder="Type your message...">
                </textarea>
              </mat-form-field>
              <div class="form-actions">
                <button class="btn btn-primary"
                        type="submit"
                        [disabled]="sending()
                                    || !selectedAccountId
                                    || !recipient.trim()
                                    || !textMessage.trim()">
                  @if (sending()) {
                    <mat-spinner diameter="14" />
                  } @else {
                    <lucide-icon [img]="Send" [size]="14" />
                    Send Text
                  }
                </button>
              </div>
            </form>
          </div>
        </mat-tab>

        <!-- Template message tab (Meta only) -->
        @if (!isTelegram) {
        <mat-tab label="Template Message">
          <div class="tab-body">
            <div class="info-box">
              <lucide-icon [img]="FileText" [size]="14" />
              <span>
                Enter the approved template name and language code.
                Templates must be pre-approved in Meta Business Manager.
              </span>
            </div>
            <form (ngSubmit)="sendTemplate()" class="msg-form">
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>{{ recipientLabel }}</mat-label>
                <input matInput
                       [(ngModel)]="recipient"
                       name="tplRecipient"
                       required
                       [placeholder]="recipientPlaceholder" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Template Name</mat-label>
                <input matInput
                       [(ngModel)]="templateName"
                       name="templateName"
                       required
                       placeholder="hello_world" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Language Code</mat-label>
                <input matInput
                       [(ngModel)]="languageCode"
                       name="languageCode"
                       required
                       placeholder="en_US" />
              </mat-form-field>
              <div class="form-actions">
                <button class="btn btn-primary"
                        type="submit"
                        [disabled]="sending()
                                    || !selectedAccountId
                                    || !recipient.trim()
                                    || !templateName.trim()
                                    || !languageCode.trim()">
                  @if (sending()) {
                    <mat-spinner diameter="14" />
                  } @else {
                    <lucide-icon [img]="Send" [size]="14" />
                    Send Template
                  }
                </button>
              </div>
            </form>
          </div>
        </mat-tab>
        }
      </mat-tab-group>
    </div>
  `,
  styles: `
    .composer-page {
      max-width: 600px;
      margin: 0 auto;
    }
    .full-width {
      width: 100%;
    }
    .tab-body {
      padding-top: 20px;
    }
    .msg-form {
      display: flex;
      flex-direction: column;
    }
    .form-actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 4px;
    }
    .info-box {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      background: var(--accent-dim);
      border: 1px solid rgba(34, 197, 94, 0.2);
      border-radius: var(--radius);
      padding: 12px 14px;
      margin-bottom: 16px;
      font-size: 12px;
      color: var(--accent2);
      line-height: 1.5;
    }
  `,
})
export class MessageComposerComponent implements OnInit {
  protected readonly Send = Send;
  protected readonly FileText = FileText;
  protected readonly CheckCircle = CheckCircle;
  protected readonly AlertCircle = AlertCircle;

  private readonly channelService = inject(ChannelService);

  readonly accounts = signal<IChannelAccount[]>([]);
  readonly sending = signal(false);
  readonly result = signal<{ type: "ok" | "error"; text: string } | null>(
    null,
  );

  selectedAccountId = "";

  protected get isTelegram(): boolean {
    const acct = this.accounts().find(
      (a) => a.id === this.selectedAccountId,
    );
    return acct?.channel === "telegram";
  }

  protected get recipientLabel(): string {
    return this.isTelegram
      ? "Recipient (Chat ID)"
      : "Recipient (phone number or ID)";
  }

  protected get recipientPlaceholder(): string {
    return this.isTelegram ? "123456789" : "+5491155550123";
  }
  recipient = "";
  textMessage = "";
  templateName = "";
  languageCode = "en_US";

  ngOnInit(): void {
    this.channelService.listAccounts().subscribe({
      next: (data) => {
        const list = Array.isArray(data) ? data : [];
        this.accounts.set(list);
        if (list.length > 0) {
          this.selectedAccountId = list[0].id;
        }
      },
    });
  }

  onTabChange(_event: unknown): void {
    this.result.set(null);
  }

  sendText(): void {
    if (!this.selectedAccountId || !this.recipient || !this.textMessage) return;

    const body: ISendMessageDto = {
      to: this.recipient.trim(),
      type: "text",
      text: this.textMessage.trim(),
    };

    this.doSend(body, "Text message sent.");
  }

  sendTemplate(): void {
    if (
      !this.selectedAccountId ||
      !this.recipient ||
      !this.templateName ||
      !this.languageCode
    )
      return;

    const body: ISendMessageDto = {
      to: this.recipient.trim(),
      type: "template",
      templateName: this.templateName.trim(),
      templateLanguage: this.languageCode.trim(),
    };

    this.doSend(body, "Template message sent.");
  }

  private doSend(body: ISendMessageDto, successMsg: string): void {
    this.sending.set(true);
    this.result.set(null);

    this.channelService
      .sendMessage(this.selectedAccountId, body)
      .subscribe({
        next: () => {
          this.sending.set(false);
          this.result.set({ type: "ok", text: successMsg });
          this.textMessage = "";
        },
        error: (err) => {
          this.sending.set(false);
          this.result.set({
            type: "error",
            text: err?.error?.message ?? err?.message ?? "Send failed",
          });
        },
      });
  }
}
