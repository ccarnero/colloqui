import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from "@angular/core";
import { DatePipe } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatTableModule } from "@angular/material/table";
import { MatChipsModule } from "@angular/material/chips";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { ChannelAdminService } from "../../core/services/channel-admin.service";
import { AuthService } from "../../core/services/auth.service";
import {
  AccountDialogComponent,
  type IAccountDialogResult,
} from "./account-dialog.component";
import type { IChannelAccount } from "../../core/models/channel-account.model";
import { PageHeaderComponent } from "../../shared/components/page-header/page-header.component";
import { StatusBadgeComponent } from "../../shared/components/status-badge/status-badge.component";
import {
  ConfirmDialogComponent,
  type IConfirmDialogData,
} from "../../shared/components/confirm-dialog/confirm-dialog.component";

@Component({
  selector: "app-channels",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatChipsModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    PageHeaderComponent,
    StatusBadgeComponent,
  ],
  template: `
    <app-page-header title="Channels" subtitle="Manage channel accounts">
      <ng-container slot="actions">
        <button
          type="button"
          class="btn btn-primary btn-sm"
          (click)="openCreate()"
        >
          <mat-icon>add</mat-icon>
          Connect Account
        </button>
      </ng-container>
    </app-page-header>

    @if (loading()) {
      <div class="stats-row" style="opacity: 0.4;">
        <div class="stat-card">
          <div class="stat-value">—</div>
          <div class="stat-label">Total Accounts</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">—</div>
          <div class="stat-label">Active</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">—</div>
          <div class="stat-label">Inactive</div>
        </div>
      </div>
      <div class="table-wrap" style="padding: 32px; text-align: center;">
        <mat-spinner diameter="32" />
        <p style="margin-top: 12px; color: var(--text3);">
          Loading accounts...
        </p>
      </div>
    } @else if (error()) {
      <div class="alert alert-error">
        <mat-icon>error_outline</mat-icon>
        <div>
          <strong>Failed to load accounts</strong>
          <p style="margin-top: 4px;">{{ error() }}</p>
          <button
            class="btn btn-secondary btn-sm"
            style="margin-top: 8px;"
            (click)="loadAccounts()"
          >
            Retry
          </button>
        </div>
      </div>
    } @else if (filteredAccounts().length === 0) {
      <div class="section-card" style="padding: 32px; text-align: center;">
        <mat-icon style="font-size: 40px; color: var(--text3);"
          >account_box</mat-icon
        >
        <p style="margin-top: 12px; font-weight: 600;">No accounts found</p>
        <p style="color: var(--text3); margin-top: 4px;">
          Connect your first {{ channelFilter() }} account to get started.
        </p>
      </div>
    } @else {
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
              <a
                class="account-name-link"
                [routerLink]="['/channels', channelFilter(), 'accounts', a.id]"
              >
                {{ a.name }}
              </a>
            </td>
          </ng-container>

          <ng-container matColumnDef="externalId">
            <th mat-header-cell *matHeaderCellDef>External ID</th>
            <td mat-cell *matCellDef="let a" class="mono">
              {{ a.externalId }}
            </td>
          </ng-container>

          <ng-container matColumnDef="status">
            <th mat-header-cell *matHeaderCellDef>Status</th>
            <td mat-cell *matCellDef="let a">
              <app-status-badge
                [status]="a.isActive ? 'Active' : 'Inactive'"
                [color]="a.isActive ? 'green' : 'red'"
              />
            </td>
          </ng-container>

          <ng-container matColumnDef="createdAt">
            <th mat-header-cell *matHeaderCellDef>Created</th>
            <td mat-cell *matCellDef="let a" class="muted">
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
    }
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

    .account-name-link {
      color: var(--text);
      font-weight: 600;
      text-decoration: none;
    }
    .account-name-link:hover {
      color: var(--accent, var(--text));
      text-decoration: underline;
    }

    .mono {
      font-family: monospace;
    }

    .muted {
      color: var(--text3);
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

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

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
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: "Delete Account",
        message: `Delete account "${account.name}"?\n\nThis will also delete all auto-reply rules and messages for this account.`,
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        variant: "danger",
        icon: "delete_forever",
      } satisfies IConfirmDialogData,
    });
    ref.afterClosed().subscribe((confirmed: boolean | undefined) => {
      if (confirmed) {
        this.channels.deleteAccount(account.id).subscribe({
          next: () => this.loadAccounts(),
        });
      }
    });
  }

  protected loadAccounts(): void {
    this.loading.set(true);
    this.error.set(null);
    this.channels.listAccounts().subscribe({
      next: (data) => {
        this.accounts.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.message ?? "Failed to load accounts");
        this.loading.set(false);
      },
    });
  }
}
