import { Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatButtonModule } from "@angular/material/button";
import { MatSelectModule } from "@angular/material/select";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import {
  LucideAngularModule,
  Phone,
  Instagram,
  ArrowLeft,
} from "lucide-angular";
import {
  ChannelService,
  ICreateAccountDto,
} from "../../core/services/channel.service";

type ChannelChoice = "whatsapp" | "instagram" | null;

@Component({
  selector: "app-connect-account",
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
    <div class="connect-page">
      <button class="back-btn" (click)="goBack()">
        <lucide-icon [img]="ArrowLeft" [size]="16" />
        Back to Accounts
      </button>

      <h1 class="ws-title">Connect Account</h1>
      <p class="ws-subtitle">
        Connect a WhatsApp or Instagram account to start sending
        and receiving messages.
      </p>

      @if (error()) {
        <div class="alert alert-error">{{ error() }}</div>
      }

      @if (!channel()) {
        <div class="channel-picker">
          <button class="channel-option" (click)="channel.set('whatsapp')">
            <lucide-icon [img]="Phone" [size]="24" />
            <h3>WhatsApp Business</h3>
            <p>Connect via Meta Cloud API with WABA ID and access token.</p>
          </button>
          <button class="channel-option ig" (click)="channel.set('instagram')">
            <lucide-icon [img]="Instagram" [size]="24" />
            <h3>Instagram</h3>
            <p>Connect an Instagram Professional account for DMs.</p>
          </button>
        </div>
      } @else if (channel() === "whatsapp") {
        <form (ngSubmit)="submitWhatsApp()" class="connect-form">
          <h2 class="form-title">
            <lucide-icon [img]="Phone" [size]="18" />
            WhatsApp Business
          </h2>
          <mat-form-field appearance="outline">
            <mat-label>WABA ID *</mat-label>
            <input matInput [(ngModel)]="wabaId" name="wabaId" required />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Phone Number ID *</mat-label>
            <input matInput
                   [(ngModel)]="phoneNumberId"
                   name="phoneNumberId"
                   required />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Access Token *</mat-label>
            <input matInput
                   [(ngModel)]="accessToken"
                   name="accessToken"
                   required />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Account Name (optional)</mat-label>
            <input matInput
                   [(ngModel)]="businessName"
                   name="businessName"
                   placeholder="e.g. My WhatsApp Business" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Meta App ID (optional)</mat-label>
            <input matInput
                   [(ngModel)]="metaAppId"
                   name="metaAppId" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Meta App Secret (optional)</mat-label>
            <input matInput
                   [(ngModel)]="metaAppSecret"
                   name="metaAppSecret"
                   type="password" />
          </mat-form-field>

          <div class="form-actions">
            <button type="button"
                    class="btn btn-secondary"
                    (click)="channel.set(null)">
              Back
            </button>
            <button type="submit"
                    class="btn btn-primary"
                    [disabled]="submitting()">
              @if (submitting()) {
                <mat-spinner diameter="16" />
              } @else {
                Connect WhatsApp
              }
            </button>
          </div>
        </form>
      } @else {
        <form (ngSubmit)="submitInstagram()" class="connect-form">
          <h2 class="form-title">
            <lucide-icon [img]="Instagram" [size]="18" />
            Instagram
          </h2>
          <div class="info-box">
            <p>
              Generate a token from the
              <a href="https://developers.facebook.com/tools/explorer/"
                 target="_blank"
                 rel="noopener noreferrer">
                Graph API Explorer
              </a>
              with <code>instagram_manage_messages</code> permission.
            </p>
          </div>
          <mat-form-field appearance="outline">
            <mat-label>Access Token *</mat-label>
            <input matInput
                   [(ngModel)]="accessToken"
                   name="accessToken"
                   required />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>IG User ID (optional)</mat-label>
            <input matInput
                   [(ngModel)]="igUserId"
                   name="igUserId" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Account Name (optional)</mat-label>
            <input matInput
                   [(ngModel)]="igUsername"
                   name="igUsername"
                   placeholder="e.g. My Instagram" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Meta App ID (optional)</mat-label>
            <input matInput
                   [(ngModel)]="metaAppId"
                   name="metaAppId" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Meta App Secret (optional)</mat-label>
            <input matInput
                   [(ngModel)]="metaAppSecret"
                   name="metaAppSecret"
                   type="password" />
          </mat-form-field>

          <div class="form-actions">
            <button type="button"
                    class="btn btn-secondary"
                    (click)="channel.set(null)">
              Back
            </button>
            <button type="submit"
                    class="btn btn-primary"
                    [disabled]="submitting()">
              @if (submitting()) {
                <mat-spinner diameter="16" />
              } @else {
                Connect Instagram
              }
            </button>
          </div>
        </form>
      }
    </div>
  `,
  styles: `
    .connect-page {
      max-width: 520px;
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
    .back-btn:hover {
      color: var(--text);
    }
    .channel-picker {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-top: 24px;
    }
    .channel-option {
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: var(--radius2);
      padding: 24px;
      text-align: left;
      cursor: pointer;
      transition: all 0.15s;
      color: var(--text);
    }
    .channel-option:hover {
      border-color: var(--accent);
      box-shadow: var(--shadow);
    }
    .channel-option.ig:hover {
      border-color: var(--purple);
    }
    .channel-option h3 {
      font-size: 15px;
      font-weight: 600;
      margin: 12px 0 6px;
    }
    .channel-option p {
      font-size: 12px;
      color: var(--text3);
      line-height: 1.4;
    }
    .connect-form {
      display: flex;
      flex-direction: column;
      margin-top: 24px;
    }
    .connect-form mat-form-field {
      width: 100%;
    }
    .form-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 20px;
    }
    .form-actions {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      margin-top: 8px;
    }
    .info-box {
      background: var(--purple-dim);
      border: 1px solid rgba(168, 85, 247, 0.2);
      border-radius: var(--radius);
      padding: 12px 14px;
      margin-bottom: 16px;
      font-size: 12px;
      color: var(--purple);
      line-height: 1.5;
    }
    .info-box a {
      color: inherit;
      text-decoration: underline;
    }
    .info-box code {
      background: rgba(168, 85, 247, 0.15);
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 11px;
    }
  `,
})
export class ConnectAccountComponent {
  protected readonly Phone = Phone;
  protected readonly Instagram = Instagram;
  protected readonly ArrowLeft = ArrowLeft;

  private readonly channelService = inject(ChannelService);
  private readonly router = inject(Router);

  readonly channel = signal<ChannelChoice>(null);
  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);

  wabaId = "";
  phoneNumberId = "";
  accessToken = "";
  businessName = "";
  metaAppId = "";
  metaAppSecret = "";
  igUserId = "";
  igUsername = "";

  goBack(): void {
    this.router.navigate(["/accounts"]);
  }

  submitWhatsApp(): void {
    if (!this.wabaId || !this.phoneNumberId || !this.accessToken) return;
    this.submit({
      channel: "whatsapp",
      name: this.businessName.trim() || `WABA ${this.wabaId.trim()}`,
      externalId: this.wabaId.trim(),
      wabaId: this.wabaId.trim(),
      phoneNumberId: this.phoneNumberId.trim(),
      accessToken: this.accessToken.trim(),
      appId: this.metaAppId.trim() || undefined,
      appSecret: this.metaAppSecret.trim() || undefined,
    });
  }

  submitInstagram(): void {
    if (!this.accessToken) return;
    const extId = this.igUserId.trim() || "pending";
    this.submit({
      channel: "instagram",
      name: this.igUsername.trim() || `IG ${extId}`,
      externalId: extId,
      igUserId: this.igUserId.trim() || undefined,
      accessToken: this.accessToken.trim(),
      appId: this.metaAppId.trim() || undefined,
      appSecret: this.metaAppSecret.trim() || undefined,
    });
  }

  private submit(body: ICreateAccountDto): void {
    this.submitting.set(true);
    this.error.set(null);

    this.channelService.createAccount(body).subscribe({
      next: () => {
        this.submitting.set(false);
        this.router.navigate(["/accounts"]);
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(
          err?.error?.message ?? err?.message ?? "Connection failed",
        );
      },
    });
  }
}
