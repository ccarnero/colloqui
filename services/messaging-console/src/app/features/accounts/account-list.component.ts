import { Component, inject, signal, OnInit } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatMenuModule } from "@angular/material/menu";
import { MatTooltipModule } from "@angular/material/tooltip";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import {
  LucideAngularModule,
  Phone,
  Instagram,
  Settings,
  Trash2,
  Plus,
  RefreshCw,
} from "lucide-angular";
import {
  ChannelService,
  IChannelAccount,
} from "../../core/services/channel.service";

@Component({
  selector: "app-account-list",
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    LucideAngularModule,
  ],
  template: `
    <div class="ws-header">
      <div>
        <h1 class="ws-title">Channel Accounts</h1>
        <p class="ws-subtitle">
          Manage your connected WhatsApp and Instagram accounts
        </p>
      </div>
      <div class="ws-actions">
        <button class="btn btn-secondary btn-sm"
                (click)="loadAccounts()"
                matTooltip="Refresh">
          <lucide-icon [img]="RefreshCw" [size]="14" />
        </button>
        <button class="btn btn-primary" routerLink="/connect">
          <lucide-icon [img]="Plus" [size]="14" />
          Connect Account
        </button>
      </div>
    </div>

    @if (loading()) {
      <div class="loading-state">
        <mat-spinner diameter="28" />
      </div>
    } @else if (accounts().length === 0) {
      <div class="empty-state">
        <lucide-icon [img]="Phone" [size]="32" />
        <h3>No accounts connected</h3>
        <p>Connect a WhatsApp or Instagram account to get started.</p>
        <button class="btn btn-primary" routerLink="/connect">
          <lucide-icon [img]="Plus" [size]="14" />
          Connect Account
        </button>
      </div>
    } @else {
      <div class="accounts-grid">
        @for (account of accounts(); track account.id) {
          <div class="account-card">
            <div class="account-header">
              <div class="account-channel">
                @if (account.channel === "instagram") {
                  <lucide-icon [img]="Instagram" [size]="16" />
                  <span class="badge badge-purple">Instagram</span>
                } @else {
                  <lucide-icon [img]="Phone" [size]="16" />
                  <span class="badge badge-green">WhatsApp</span>
                }
              </div>
              <button class="icon-action"
                      [routerLink]="['/accounts', account.id, 'settings']"
                      matTooltip="Settings">
                <lucide-icon [img]="Settings" [size]="14" />
              </button>
            </div>
            <div class="account-body">
              <h3 class="account-name">
                {{ account.name || "Unnamed" }}
              </h3>
              @if (account.channel === "whatsapp") {
                <p class="account-detail">Phone: {{ account.phoneNumberId || "—" }}</p>
                <p class="account-id">WABA: {{ account.wabaId || "—" }}</p>
              } @else {
                <p class="account-detail">IG: {{ account.igUserId || "—" }}</p>
                <p class="account-id">External: {{ account.externalId || "—" }}</p>
              }
              @if (!account.isActive) {
                <span class="badge badge-red">Inactive</span>
              }
            </div>
            <div class="account-footer">
              <button class="btn btn-sm btn-secondary"
                      [routerLink]="['/accounts', account.id, 'settings']">
                <lucide-icon [img]="Settings" [size]="12" />
                Settings
              </button>
              <button class="btn btn-sm btn-danger"
                      (click)="confirmDelete(account)"
                      matTooltip="Delete account">
                <lucide-icon [img]="Trash2" [size]="12" />
              </button>
            </div>
          </div>
        }
      </div>
    }
  `,
  styles: `
    .loading-state {
      display: flex;
      justify-content: center;
      padding: 60px;
    }
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 80px 20px;
      color: var(--text3);
      text-align: center;
    }
    .empty-state h3 {
      font-size: 16px;
      font-weight: 600;
      color: var(--text2);
    }
    .empty-state p {
      font-size: 13px;
      max-width: 280px;
    }
    .accounts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 16px;
    }
    .account-card {
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: var(--radius2);
      overflow: hidden;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .account-card:hover {
      border-color: var(--border2);
      box-shadow: var(--shadow);
    }
    .account-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
    }
    .account-channel {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .account-body {
      padding: 16px;
    }
    .account-name {
      font-size: 15px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .account-detail {
      font-size: 13px;
      color: var(--text2);
    }
    .account-id {
      font-size: 11px;
      color: var(--text3);
      font-family: monospace;
      margin-top: 4px;
    }
    .account-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      border-top: 1px solid var(--border);
      background: var(--bg3);
    }
    .icon-action {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: var(--radius);
      background: none;
      border: none;
      color: var(--text3);
      cursor: pointer;
      transition: all 0.15s;
    }
    .icon-action:hover {
      color: var(--text);
      background: var(--bg4);
    }
  `,
})
export class AccountListComponent implements OnInit {
  protected readonly Phone = Phone;
  protected readonly Instagram = Instagram;
  protected readonly Settings = Settings;
  protected readonly Trash2 = Trash2;
  protected readonly Plus = Plus;
  protected readonly RefreshCw = RefreshCw;

  private readonly channelService = inject(ChannelService);
  private readonly router = inject(Router);

  readonly accounts = signal<IChannelAccount[]>([]);
  readonly loading = signal(true);

  ngOnInit(): void {
    this.loadAccounts();
  }

  loadAccounts(): void {
    this.loading.set(true);
    this.channelService.listAccounts().subscribe({
      next: (data) => {
        const list = Array.isArray(data) ? data : [];
        this.accounts.set(list);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  confirmDelete(account: IChannelAccount): void {
    const name = account.name || account.id;

    if (!confirm(`Delete account "${name}"? This cannot be undone.`)) return;

    this.channelService.deleteAccount(account.id).subscribe({
      next: () => {
        this.accounts.update((prev) =>
          prev.filter((a) => a.id !== account.id),
        );
      },
    });
  }
}
