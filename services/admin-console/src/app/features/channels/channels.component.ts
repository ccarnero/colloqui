import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatChipsModule } from "@angular/material/chips";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { MatTableModule } from "@angular/material/table";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { environment } from "../../../environments/environment";
import type { IChannelAccount } from "../../core/models/channel-account.model";
import { AuthService } from "../../core/services/auth.service";
import { ChannelAdminService } from "../../core/services/channel-admin.service";
import {
  ConfirmDialogComponent,
  type IConfirmDialogData,
} from "../../shared/components/confirm-dialog/confirm-dialog.component";
import { PageHeaderComponent } from "../../shared/components/page-header/page-header.component";
import { StatusBadgeComponent } from "../../shared/components/status-badge/status-badge.component";
import { UtcDatePipe } from "../../shared/pipes/utc-date.pipe";
import {
  AccountDialogComponent,
  type IAccountDialogResult,
} from "./account-dialog.component";

@Component({
  selector: "app-channels",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    UtcDatePipe,
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

    @if (isHttp()) {
      <div class="section-card" style="padding: 16px; margin-bottom: 16px;">
        <p style="font-weight: 600; margin-bottom: 6px;">
          Send messages to this channel
        </p>
        <p class="muted" style="margin-bottom: 10px;">
          Each HTTP account has its <strong>own ingest URL</strong> — the account's
          <span class="mono">externalId</span> is the last path segment. POST JSON to it
          with that account's webhook token (the <strong>App Secret</strong> shown when
          you connect the account). Same flow as the
          <span class="mono">sdk/examples/reference-pattern</span> example.
        </p>
        @for (a of filteredAccounts(); track a.id) {
          <div style="margin-bottom: 12px;">
            <p class="mono" style="font-size: 12px; margin: 0 0 4px;">
              {{ a.name }} <span class="muted">· {{ a.externalId }}</span>
            </p>
            <pre
              class="mono"
              style="background: var(--bg2); padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 12px; white-space: pre; margin: 0;"
            >{{ ingestCurlFor(a) }}</pre>
          </div>
        } @empty {
          <p class="muted" style="font-size: 12px; margin: 0;">
            Connect an HTTP account to get its dedicated ingest URL.
          </p>
        }
      </div>
    }

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
              {{ a.createdAt | utcDate: "short" }}
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
    this.accounts().filter((a) => a.channel === this.channelFilter())
  );

  readonly totalAccounts = computed(() => this.filteredAccounts().length);
  readonly activeAccounts = computed(
    () => this.filteredAccounts().filter((a) => a.isActive).length
  );
  readonly inactiveAccounts = computed(
    () => this.filteredAccounts().filter((a) => !a.isActive).length
  );

  readonly isHttp = computed(() => this.channelFilter() === "http");

  /**
   * Per-instance ingest URL: the account `externalId` is the last path segment
   * (`/api/webhooks/http/<tenant>/<externalId>`), so each HTTP account is its own
   * addressable endpoint.
   */
  private ingestUrlFor(externalId: string): string {
    const tenant = this.auth.tenantId() ?? "<tenant>";
    return `${window.location.origin}${environment.apiUrl}/webhooks/http/${tenant}/${externalId}`;
  }

  ingestCurlFor(account: IChannelAccount): string {
    const token = account.appSecret ?? "<app-secret>";
    return (
      `curl -X POST ${this.ingestUrlFor(account.externalId)} \\\n` +
      `  -H 'content-type: application/json' \\\n` +
      `  -H 'x-http-channel-token: ${token}' \\\n` +
      `  -d '{"from":"customer@example.com","text":"hello"}'`
    );
  }

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
      if (result?.saved) {
        this.loadAccounts();
      }
    });
  }

  openEdit(account: IChannelAccount): void {
    const ref = this.dialog.open(AccountDialogComponent, {
      data: { account },
      width: "520px",
    });
    ref.afterClosed().subscribe((result?: IAccountDialogResult) => {
      if (result?.saved) {
        this.loadAccounts();
      }
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
