import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from "@angular/core";
import { DatePipe, TitleCasePipe } from "@angular/common";
import { ActivatedRoute } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatTableModule } from "@angular/material/table";
import { MatChipsModule } from "@angular/material/chips";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { ChannelAdminService } from "../../core/services/channel-admin.service";
import { AuthService } from "../../core/services/auth.service";
import {
  AccountDialogComponent,
  type IAccountDialogResult,
} from "./account-dialog.component";
import type { IChannelAccount } from "../../core/models/channel-account.model";

@Component({
  selector: "app-channels",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    TitleCasePipe,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatChipsModule,
    MatDialogModule,
  ],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">{{ channelFilter() | titlecase }}</div>
        <div class="ws-subtitle">
          Manage {{ channelFilter() | titlecase }} channel accounts
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
        <div class="stat-value">{{ inactiveAccounts() }}</div>
        <div class="stat-label">Inactive</div>
      </div>
    </div>

    <div class="table-wrap">
      <table mat-table [dataSource]="filteredAccounts()">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Name</th>
          <td mat-cell *matCellDef="let a">
            <strong>{{ a.name }}</strong>
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
      grid-template-columns: repeat(3, 1fr);
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
  private readonly channels = inject(ChannelAdminService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);

  readonly cols = [
    "name",
    "externalId",
    "status",
    "createdAt",
    "actions",
  ] as const;

  readonly channelFilter = signal("whatsapp");
  readonly accounts = signal<IChannelAccount[]>([]);

  readonly filteredAccounts = computed(() =>
    this.accounts().filter((a) => a.channel === this.channelFilter()),
  );

  readonly totalAccounts = computed(() => this.filteredAccounts().length);
  readonly activeAccounts = computed(
    () => this.filteredAccounts().filter((a) => a.isActive).length,
  );
  readonly inactiveAccounts = computed(
    () => this.filteredAccounts().filter((a) => !a.isActive).length,
  );

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      this.channelFilter.set(params.get("channel") ?? "whatsapp");
      this.loadAccounts();
    });
  }

  openCreate(): void {
    const ref = this.dialog.open(AccountDialogComponent, {
      data: { defaultChannel: this.channelFilter() },
      width: "520px",
    });
    ref.afterClosed().subscribe((result?: IAccountDialogResult) => {
      if (result?.saved) this.loadAccounts();
    });
  }

  openEdit(account: IChannelAccount): void {
    const ref = this.dialog.open(AccountDialogComponent, {
      data: { account },
      width: "520px",
    });
    ref.afterClosed().subscribe((result?: IAccountDialogResult) => {
      if (result?.saved) this.loadAccounts();
    });
  }

  confirmDelete(account: IChannelAccount): void {
    const confirmed = confirm(
      `Delete account "${account.name}"?\n\nThis will also delete all auto-reply rules and messages for this account.`,
    );
    if (!confirmed) return;

    this.channels.deleteAccount(account.id).subscribe({
      next: () => this.loadAccounts(),
    });
  }

  private loadAccounts(): void {
    this.channels.listAccounts().subscribe({
      next: (data) => this.accounts.set(data),
    });
  }
}
