import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  OnInit,
  input,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatButtonModule } from "@angular/material/button";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import {
  LucideAngularModule,
  ArrowLeft,
  Key,
  RefreshCw,
  Shield,
  Info,
  Save,
} from "lucide-angular";
import { getHttpErrorMessage } from "../../core/utils/http-error-message";
import {
  ChannelService,
  IChannelAccount,
} from "../../core/services/channel.service";

@Component({
  selector: "app-account-settings",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    LucideAngularModule,
  ],
  template: `
    <div class="settings-page">
      <button class="back-btn" (click)="goBack()">
        <lucide-icon [img]="ArrowLeft" [size]="16" />
        Back to Accounts
      </button>

      <h1 class="ws-title">Account Settings</h1>

      @if (loading()) {
        <div class="loading-state">
          <mat-spinner diameter="28" />
        </div>
      } @else if (account()) {
        @if (message()) {
          <div class="alert"
               [class.alert-info]="message()!.type === 'ok'"
               [class.alert-error]="message()!.type === 'error'">
            {{ message()!.text }}
          </div>
        }

        <!-- Account Info -->
        <div class="section-card">
          <div class="section-card-header">
            <div class="section-title-row">
              <lucide-icon [img]="Info" [size]="16" />
              <span class="section-card-title">Account Information</span>
              @if (account()!.channel === "instagram") {
                <span class="badge badge-purple">Instagram</span>
              } @else if (account()!.channel === "telegram") {
                <span class="badge badge-blue">Telegram</span>
              } @else {
                <span class="badge badge-green">WhatsApp</span>
              }
            </div>
          </div>
          <div class="section-card-body">
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">Name</span>
                <span class="info-value">
                  {{ account()!.name || "—" }}
                </span>
              </div>
              <div class="info-item">
                <span class="info-label">Provider</span>
                <span class="info-value">{{ account()!.provider }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">External ID</span>
                <span class="info-value mono">
                  {{ account()!.externalId || "—" }}
                </span>
              </div>
              <div class="info-item">
                <span class="info-label">Status</span>
                <span class="info-value">
                  @if (account()!.isActive) {
                    <span class="badge badge-green">Active</span>
                  } @else {
                    <span class="badge badge-red">Inactive</span>
                  }
                </span>
              </div>
              @if (account()!.channel === "whatsapp") {
                <div class="info-item">
                  <span class="info-label">WABA ID</span>
                  <span class="info-value mono">
                    {{ account()!.wabaId || "—" }}
                  </span>
                </div>
                <div class="info-item">
                  <span class="info-label">Phone Number ID</span>
                  <span class="info-value mono">
                    {{ account()!.phoneNumberId || "—" }}
                  </span>
                </div>
              } @else if (account()!.channel === "telegram") {
                <div class="info-item">
                  <span class="info-label">Bot Username</span>
                  <span class="info-value mono">
                    @{{ account()!.externalId }}
                  </span>
                </div>
              } @else {
                <div class="info-item">
                  <span class="info-label">IG User ID</span>
                  <span class="info-value mono">
                    {{ account()!.igUserId || "—" }}
                  </span>
                </div>
              }
              @if (account()!.channel !== "telegram") {
                <div class="info-item">
                  <span class="info-label">Meta App ID</span>
                  <span class="info-value mono">
                    {{ account()!.appId || "— (server default)" }}
                  </span>
                </div>
              }
            </div>
          </div>
        </div>

        <!-- Update Access Token -->
        <div class="section-card">
          <div class="section-card-header">
            <div class="section-title-row">
              <lucide-icon [img]="Key" [size]="16" />
              <span class="section-card-title">Update Access Token</span>
            </div>
          </div>
          <div class="section-card-body">
            <p class="hint">
              @if (account()!.channel === "telegram") {
                Paste a new bot token from BotFather to update the stored credentials.
              } @else {
                Paste a new token from the Meta App Dashboard to update the stored credentials.
              }
            </p>
            <form (ngSubmit)="updateToken()" class="inline-form">
              <mat-form-field appearance="outline">
                <mat-label>
                  @if (account()!.channel === "telegram") {
                    New Bot Token
                  } @else {
                    New Access Token
                  }
                </mat-label>
                <input matInput
                       [(ngModel)]="newToken"
                       name="newToken"
                       [placeholder]="account()!.channel === 'telegram' ? '123456:ABC-DEF...' : 'EAAG...'" />
              </mat-form-field>
              <button class="btn btn-primary"
                      type="submit"
                      [disabled]="savingToken() || !newToken.trim()">
                @if (savingToken()) {
                  <mat-spinner diameter="14" />
                } @else {
                  <lucide-icon [img]="Save" [size]="14" />
                  Update
                }
              </button>
            </form>
          </div>
        </div>

        <!-- Refresh Meta Token (long-lived exchange) -->
        @if (account()!.channel !== "telegram") {
        <div class="section-card">
          <div class="section-card-header">
            <div class="section-title-row">
              <lucide-icon [img]="RefreshCw" [size]="16" />
              <span class="section-card-title">
                Refresh Token (Long-Lived)
              </span>
            </div>
          </div>
          <div class="section-card-body">
            @if (account()!.appId && account()!.appSecret) {
              <p class="hint">
                Exchange the current access token for a long-lived one
                (~60 days) using Meta's <code>fb_exchange_token</code>
                grant. The server will call the Graph API with your
                App ID and App Secret.
              </p>
              <button class="btn btn-primary"
                      (click)="refreshMetaToken()"
                      [disabled]="refreshingToken()">
                @if (refreshingToken()) {
                  <mat-spinner diameter="14" />
                } @else {
                  <lucide-icon [img]="RefreshCw" [size]="14" />
                  Refresh Token
                }
              </button>
            } @else {
              <p class="hint hint-warn">
                Meta App ID and App Secret are required to exchange
                tokens. Fill in the credentials below first.
              </p>
            }
          </div>
        </div>
        }

        <!-- Update Meta Credentials -->
        @if (account()!.channel !== "telegram") {
        <div class="section-card">
          <div class="section-card-header">
            <div class="section-title-row">
              <lucide-icon [img]="Shield" [size]="16" />
              <span class="section-card-title">Meta App Credentials</span>
            </div>
          </div>
          <div class="section-card-body">
            <p class="hint">
              If this account uses a different Meta app, update the
              App ID and Secret here.
            </p>
            <form (ngSubmit)="updateCredentials()" class="creds-form">
              <mat-form-field appearance="outline">
                <mat-label>App ID</mat-label>
                <input matInput
                       [(ngModel)]="newAppId"
                       name="newAppId"
                       [placeholder]="account()!.appId || '1690770278576601'" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>App Secret</mat-label>
                <input matInput
                       [(ngModel)]="newAppSecret"
                       name="newAppSecret"
                       type="password"
                       placeholder="••••••••" />
              </mat-form-field>
              <button class="btn btn-primary"
                      type="submit"
                      [disabled]="savingCreds()
                                  || !newAppId.trim()
                                  || !newAppSecret.trim()">
                @if (savingCreds()) {
                  <mat-spinner diameter="14" />
                } @else {
                  <lucide-icon [img]="Save" [size]="14" />
                  Save Credentials
                }
              </button>
            </form>
          </div>
        </div>
        }
      }
    </div>
  `,
  styles: `
    .settings-page {
      max-width: 640px;
      margin: 0 auto;
    }
    .back-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: none;
      border: none;
      color: var(--text3);
      font-size: 13px;
      cursor: pointer;
      margin-bottom: 20px;
      padding: 0;
      transition: color 0.15s;
    }
    .back-btn:hover { color: var(--text); }
    .loading-state {
      display: flex;
      justify-content: center;
      padding: 60px;
    }
    .section-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .info-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .info-label {
      font-size: 11px;
      color: var(--text3);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .info-value {
      font-size: 13px;
      color: var(--text2);
    }
    .info-value.mono {
      font-family: monospace;
      font-size: 12px;
    }
    .hint {
      font-size: 12px;
      color: var(--text3);
      margin-bottom: 14px;
      line-height: 1.5;
    }
    .inline-form {
      display: flex;
      gap: 10px;
      align-items: flex-start;
    }
    .inline-form mat-form-field {
      flex: 1;
    }
    .inline-form .btn {
      margin-top: 4px;
    }
    .creds-form {
      display: flex;
      flex-direction: column;
    }
    .creds-form mat-form-field {
      width: 100%;
    }
    .creds-form .btn {
      align-self: flex-end;
      margin-top: 4px;
    }
    .hint-warn {
      color: var(--yellow, #d97706);
    }
  `,
})
export class AccountSettingsComponent implements OnInit {
  protected readonly ArrowLeft = ArrowLeft;
  protected readonly Key = Key;
  protected readonly RefreshCw = RefreshCw;
  protected readonly Shield = Shield;
  protected readonly Info = Info;
  protected readonly Save = Save;

  /** Route param bound via withComponentInputBinding() */
  readonly id = input.required<string>();

  private readonly channelService = inject(ChannelService);
  private readonly router = inject(Router);

  readonly account = signal<IChannelAccount | null>(null);
  readonly loading = signal(true);
  readonly message = signal<{ type: "ok" | "error"; text: string } | null>(
    null,
  );

  readonly savingToken = signal(false);
  readonly savingCreds = signal(false);
  readonly refreshingToken = signal(false);

  newToken = "";
  newAppId = "";
  newAppSecret = "";

  ngOnInit(): void {
    this.channelService.getAccount(this.id()).subscribe({
      next: (data) => {
        this.account.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  goBack(): void {
    this.router.navigate(["/accounts"]);
  }

  updateToken(): void {
    const token = this.newToken.trim();
    if (!token) return;

    this.savingToken.set(true);
    this.message.set(null);

    this.channelService
      .updateAccount(this.id(), { accessToken: token })
      .subscribe({
        next: () => {
          this.savingToken.set(false);
          this.newToken = "";
          this.message.set({ type: "ok", text: "Access token updated." });
        },
        error: (err) => {
          this.savingToken.set(false);
          this.message.set({
            type: "error",
            text: getHttpErrorMessage(err, "Failed to update token"),
          });
        },
      });
  }

  refreshMetaToken(): void {
    this.refreshingToken.set(true);
    this.message.set(null);

    this.channelService.refreshMetaToken(this.id()).subscribe({
      next: (res) => {
        this.refreshingToken.set(false);
        const days = Math.round(res.expiresIn / 86_400);
        this.message.set({
          type: "ok",
          text: `Token refreshed — expires in ~${days} days.`,
        });
      },
      error: (err) => {
        this.refreshingToken.set(false);
        this.message.set({
          type: "error",
          text: getHttpErrorMessage(
            err,
            "Failed to refresh token",
          ),
        });
      },
    });
  }

  updateCredentials(): void {
    const appId = this.newAppId.trim();
    const appSecret = this.newAppSecret.trim();
    if (!appId || !appSecret) return;

    this.savingCreds.set(true);
    this.message.set(null);

    this.channelService
      .updateAccount(this.id(), { appId, appSecret })
      .subscribe({
        next: () => {
          this.savingCreds.set(false);
          this.newAppId = "";
          this.newAppSecret = "";
          this.message.set({
            type: "ok",
            text: `Credentials updated (App: ${appId}).`,
          });
        },
        error: (err) => {
          this.savingCreds.set(false);
          this.message.set({
            type: "error",
            text: getHttpErrorMessage(err, "Failed to save credentials"),
          });
        },
      });
  }
}
