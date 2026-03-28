import { Component, OnInit, inject, signal } from "@angular/core";
import { DatePipe } from "@angular/common";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatTableModule } from "@angular/material/table";
import { MatChipsModule } from "@angular/material/chips";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { HttpClient } from "@angular/common/http";
import { environment } from "../../../environments/environment";
import { AuthService } from "../../core/services/auth.service";
import {
  AccountDialogComponent,
  type AccountDialogResult,
} from "./account-dialog.component";

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
  createdAt: string;
}

@Component({
  selector: "app-channels",
  standalone: true,
  imports: [
    DatePipe,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatChipsModule,
    MatDialogModule,
  ],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Channels</div>
        <div class="ws-subtitle">
          Manage messaging channel accounts (WhatsApp, Instagram)
        </div>
      </div>
      <div class="ws-actions">
        <button
          type="button"
          class="btn btn-primary btn-sm"
          (click)="openCreate()"
        >
          <mat-icon>add</mat-icon>
          Connect Account
        </button>
      </div>
    </div>

    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-value">{{ totalAccounts() }}</div>
        <div class="stat-label">Total Accounts</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ activeAccounts() }}</div>
        <div class="stat-label">Active</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ whatsappCount() }}</div>
        <div class="stat-label">WhatsApp</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ instagramCount() }}</div>
        <div class="stat-label">Instagram</div>
      </div>
    </div>

    <div class="table-wrap">
      <table mat-table [dataSource]="accounts()">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Name</th>
          <td mat-cell *matCellDef="let a">
            <strong>{{ a.name }}</strong>
          </td>
        </ng-container>

        <ng-container matColumnDef="channel">
          <th mat-header-cell *matHeaderCellDef>Channel</th>
          <td mat-cell *matCellDef="let a">
            <span
              class="badge"
              [class.badge-green]="a.channel === 'whatsapp'"
              [class.badge-purple]="a.channel === 'instagram'"
            >
              {{ a.channel }}
            </span>
          </td>
        </ng-container>

        <ng-container matColumnDef="externalId">
          <th mat-header-cell *matHeaderCellDef>External ID</th>
          <td mat-cell *matCellDef="let a" style="font-family: monospace">
            {{ a.externalId }}
          </td>
        </ng-container>

        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Status</th>
          <td mat-cell *matCellDef="let a">
            <span
              class="badge"
              [class.badge-green]="a.isActive"
              [class.badge-red]="!a.isActive"
            >
              {{ a.isActive ? "Active" : "Inactive" }}
            </span>
          </td>
        </ng-container>

        <ng-container matColumnDef="createdAt">
          <th mat-header-cell *matHeaderCellDef>Created</th>
          <td mat-cell *matCellDef="let a" style="color: var(--text3)">
            {{ a.createdAt | date: "short" }}
          </td>
        </ng-container>

        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let a">
            <button mat-icon-button (click)="openEdit(a)">
              <mat-icon>edit</mat-icon>
            </button>
            <button mat-icon-button (click)="confirmDelete(a)">
              <mat-icon>delete</mat-icon>
            </button>
          </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="cols"></tr>
        <tr mat-row *matRowDef="let row; columns: cols"></tr>
      </table>
    </div>
  `,
  styles: `
    .stats-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }

    .stat-card {
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }

    .stat-value {
      font-size: 24px;
      font-weight: 700;
      color: var(--text);
    }

    .stat-label {
      font-size: 12px;
      color: var(--text3);
      margin-top: 4px;
    }

    .badge-green {
      background: rgba(34, 197, 94, 0.15);
      color: #22c55e;
    }

    .badge-purple {
      background: rgba(168, 85, 247, 0.15);
      color: #a855f7;
    }

    .badge-red {
      background: rgba(239, 68, 68, 0.15);
      color: #ef4444;
    }
  `,
})
export class ChannelsComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);

  readonly cols = [
    "name",
    "channel",
    "externalId",
    "status",
    "createdAt",
    "actions",
  ] as const;

  readonly accounts = signal<ChannelAccount[]>([]);
  readonly totalAccounts = signal(0);
  readonly activeAccounts = signal(0);
  readonly whatsappCount = signal(0);
  readonly instagramCount = signal(0);

  ngOnInit(): void {
    this.loadAccounts();
  }

  openCreate(): void {
    const ref = this.dialog.open(AccountDialogComponent, {
      data: {},
      width: "520px",
    });
    ref.afterClosed().subscribe((result?: AccountDialogResult) => {
      if (result?.saved) this.loadAccounts();
    });
  }

  openEdit(account: ChannelAccount): void {
    const ref = this.dialog.open(AccountDialogComponent, {
      data: { account },
      width: "520px",
    });
    ref.afterClosed().subscribe((result?: AccountDialogResult) => {
      if (result?.saved) this.loadAccounts();
    });
  }

  confirmDelete(account: ChannelAccount): void {
    const confirmed = confirm(
      `Delete account "${account.name}"?\n\nThis will also delete all auto-reply rules and messages for this account.`,
    );
    if (!confirmed) return;

    this.http.delete(`${environment.apiUrl}/channels/accounts/${account.id}`).subscribe({
      next: () => this.loadAccounts(),
    });
  }

  private loadAccounts(): void {
    this.http.get<ChannelAccount[]>(`${environment.apiUrl}/channels/accounts`).subscribe({
      next: (data) => {
        this.accounts.set(data);
        this.totalAccounts.set(data.length);
        this.activeAccounts.set(data.filter((a) => a.isActive).length);
        this.whatsappCount.set(
          data.filter((a) => a.channel === "whatsapp").length,
        );
        this.instagramCount.set(
          data.filter((a) => a.channel === "instagram").length,
        );
      },
    });
  }
}
