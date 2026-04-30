import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  OnInit,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatButtonModule } from "@angular/material/button";
import { MatSelectModule } from "@angular/material/select";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import {
  LucideAngularModule,
  Plus,
  Trash2,
  RefreshCw,
  MessageSquare,
  Zap,
} from "lucide-angular";
import { getHttpErrorMessage } from "../../core/utils/http-error-message";
import {
  ChannelService,
  IAutoReplyRule,
  IChannelAccount,
} from "../../core/services/channel.service";

@Component({
  selector: "app-auto-reply",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    LucideAngularModule,
  ],
  template: `
    <div class="auto-reply-page">
      <div class="ws-header">
        <div>
          <h1 class="ws-title">Auto-Reply Rules</h1>
          <p class="ws-subtitle">
            Automatically respond to inbound messages matching specific triggers
          </p>
        </div>
        <div class="ws-actions">
          <button class="btn btn-secondary btn-sm"
                  (click)="loadRules()">
            <lucide-icon [img]="RefreshCw" [size]="14" />
          </button>
        </div>
      </div>

      @if (error()) {
        <div class="alert alert-error">{{ error() }}</div>
      }
      @if (success()) {
        <div class="alert alert-info">{{ success() }}</div>
      }

      <!-- Create new rule -->
      <div class="section-card">
        <div class="section-card-header">
          <span class="section-card-title">
            <lucide-icon [img]="Plus" [size]="14" />
            New Rule
          </span>
        </div>
        <div class="section-card-body">
          <form (ngSubmit)="createRule()" class="rule-form">
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Account</mat-label>
              <mat-select [(ngModel)]="newAccountId" name="ruleAccount">
                @for (acct of accounts(); track acct.id) {
                  <mat-option [value]="acct.id">
                    {{ acct.name || acct.id }}
                    ({{ acct.channel }})
                  </mat-option>
                }
              </mat-select>
            </mat-form-field>
            <div class="rule-fields">
              <mat-form-field appearance="outline">
                <mat-label>Trigger (keyword or phrase)</mat-label>
                <input matInput
                       [(ngModel)]="newTrigger"
                       name="ruleTrigger"
                       required
                       placeholder="hello" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Auto-response text</mat-label>
                <input matInput
                       [(ngModel)]="newResponse"
                       name="ruleResponse"
                       required
                       placeholder="Thanks for contacting us!" />
              </mat-form-field>
            </div>
            <div class="form-actions">
              <button class="btn btn-primary"
                      type="submit"
                      [disabled]="creating()
                                  || !newAccountId
                                  || !newTrigger.trim()
                                  || !newResponse.trim()">
                @if (creating()) {
                  <mat-spinner diameter="14" />
                } @else {
                  <lucide-icon [img]="Plus" [size]="14" />
                  Create Rule
                }
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- Existing rules -->
      <div class="section-card">
        <div class="section-card-header">
          <span class="section-card-title">
            <lucide-icon [img]="MessageSquare" [size]="14" />
            Active Rules
          </span>
          <span class="rule-count">{{ rules().length }}</span>
        </div>
        <div class="section-card-body">
          @if (loading()) {
            <div class="loading-state">
              <mat-spinner diameter="24" />
            </div>
          } @else if (rules().length === 0) {
            <div class="empty-rules">
              <lucide-icon [img]="Zap" [size]="20" />
              <span>No auto-reply rules yet.</span>
            </div>
          } @else {
            @for (rule of rules(); track rule.id) {
              <div class="rule-row">
                <div class="rule-info">
                  <div class="rule-trigger">
                    <span class="badge badge-green">{{ rule.triggerPattern }}</span>
                    <span class="badge"
                          [class.badge-green]="rule.channel === 'whatsapp'"
                          [class.badge-purple]="rule.channel === 'instagram'"
                          [class.badge-blue]="rule.channel === 'telegram'">
                      {{ rule.channel }}
                    </span>
                  </div>
                  <div class="rule-response">{{ rule.replyText }}</div>
                </div>
                <button class="btn btn-sm btn-danger"
                        (click)="deleteRule(rule)"
                        [disabled]="deletingId() === rule.id">
                  @if (deletingId() === rule.id) {
                    <mat-spinner diameter="12" />
                  } @else {
                    <lucide-icon [img]="Trash2" [size]="12" />
                  }
                </button>
              </div>
            }
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    .auto-reply-page {
      max-width: 700px;
      margin: 0 auto;
    }
    .full-width {
      width: 100%;
    }
    .rule-form {
      display: flex;
      flex-direction: column;
    }
    .rule-fields {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .rule-fields mat-form-field {
      width: 100%;
    }
    .form-actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 4px;
    }
    .rule-count {
      background: var(--bg3);
      padding: 1px 8px;
      border-radius: 10px;
      font-size: 12px;
      color: var(--text3);
    }
    .loading-state {
      display: flex;
      justify-content: center;
      padding: 30px;
    }
    .empty-rules {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 30px;
      color: var(--text3);
      font-size: 13px;
    }
    .rule-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid var(--border);
    }
    .rule-row:last-child {
      border-bottom: none;
    }
    .rule-info {
      flex: 1;
      min-width: 0;
    }
    .rule-trigger {
      margin-bottom: 4px;
    }
    .rule-response {
      font-size: 13px;
      color: var(--text2);
      line-height: 1.4;
    }
  `,
})
export class AutoReplyComponent implements OnInit {
  protected readonly Plus = Plus;
  protected readonly Trash2 = Trash2;
  protected readonly RefreshCw = RefreshCw;
  protected readonly MessageSquare = MessageSquare;
  protected readonly Zap = Zap;

  private readonly channelService = inject(ChannelService);

  readonly accounts = signal<IChannelAccount[]>([]);
  readonly rules = signal<IAutoReplyRule[]>([]);
  readonly loading = signal(true);
  readonly creating = signal(false);
  readonly deletingId = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly success = signal<string | null>(null);

  newAccountId = "";
  newTrigger = "";
  newResponse = "";

  ngOnInit(): void {
    this.channelService.listAccounts().subscribe({
      next: (data) => {
        const list = Array.isArray(data) ? data : [];
        this.accounts.set(list);
        if (list.length > 0) {
          this.newAccountId = list[0].id;
        }
      },
    });
    this.loadRules();
  }

  loadRules(): void {
    this.loading.set(true);
    this.channelService.listAutoReplyRules().subscribe({
      next: (data) => {
        const list = Array.isArray(data) ? data : [];
        this.rules.set(list);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  createRule(): void {
    if (!this.newAccountId || !this.newTrigger || !this.newResponse) return;

    const acct = this.accounts().find((a) => a.id === this.newAccountId);
    if (!acct) return;

    this.creating.set(true);
    this.error.set(null);
    this.success.set(null);

    this.channelService
      .createAutoReplyRule({
        accountId: this.newAccountId,
        channel: acct.channel,
        triggerPattern: this.newTrigger.trim(),
        replyText: this.newResponse.trim(),
      })
      .subscribe({
        next: (rule) => {
          this.creating.set(false);
          this.rules.update((prev) => [rule, ...prev]);
          this.newTrigger = "";
          this.newResponse = "";
          this.success.set("Rule created.");
        },
        error: (err) => {
          this.creating.set(false);
          this.error.set(
            getHttpErrorMessage(err, "Failed to create rule"),
          );
        },
      });
  }

  deleteRule(rule: IAutoReplyRule): void {
    if (!confirm(`Delete rule "${rule.triggerPattern}"?`)) return;

    this.deletingId.set(rule.id);
    this.error.set(null);
    this.success.set(null);

    this.channelService.deleteAutoReplyRule(rule.id).subscribe({
      next: () => {
        this.deletingId.set(null);
        this.rules.update((prev) => prev.filter((r) => r.id !== rule.id));
        this.success.set("Rule deleted.");
      },
      error: (err) => {
        this.deletingId.set(null);
        this.error.set(
          getHttpErrorMessage(err, "Failed to delete rule"),
        );
      },
    });
  }
}
