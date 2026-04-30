import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatTableModule } from "@angular/material/table";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import {
  ChannelAdminService,
  type IAutoReplyRuleDto,
} from "../../../core/services/channel-admin.service";
import {
  AutoReplyDialogComponent,
  type IAutoReplyDialogResult,
} from "./auto-reply-dialog.component";

@Component({
  selector: "app-auto-reply",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatTableModule, MatDialogModule],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Auto-Reply Rules</div>
        <div class="ws-subtitle">
          Configure automatic responses for incoming messages
        </div>
      </div>
      <div class="ws-actions">
        <button
          type="button"
          class="btn btn-primary btn-sm"
          (click)="openCreate()"
        >
          <mat-icon>add</mat-icon>
          Add Rule
        </button>
      </div>
    </div>

    <div class="table-wrap">
      <table mat-table [dataSource]="rules()">
        <ng-container matColumnDef="channel">
          <th mat-header-cell *matHeaderCellDef>Channel</th>
          <td mat-cell *matCellDef="let r">
            <span class="badge badge-blue">{{ r.channel }}</span>
          </td>
        </ng-container>

        <ng-container matColumnDef="triggerPattern">
          <th mat-header-cell *matHeaderCellDef>Trigger Pattern</th>
          <td mat-cell *matCellDef="let r" style="font-family: monospace">
            {{ r.triggerPattern }}
          </td>
        </ng-container>

        <ng-container matColumnDef="replyText">
          <th mat-header-cell *matHeaderCellDef>Reply Text</th>
          <td mat-cell *matCellDef="let r">{{ r.replyText }}</td>
        </ng-container>

        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Status</th>
          <td mat-cell *matCellDef="let r">
            <span
              class="badge"
              [class.badge-green]="r.isActive"
              [class.badge-red]="!r.isActive"
            >
              {{ r.isActive ? "Active" : "Inactive" }}
            </span>
          </td>
        </ng-container>

        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let r">
            <button mat-icon-button (click)="confirmDelete(r)">
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
    .badge-green {
      background: rgba(34, 197, 94, 0.15);
      color: #22c55e;
    }

    .badge-red {
      background: rgba(239, 68, 68, 0.15);
      color: #ef4444;
    }
  `,
})
export class AutoReplyComponent implements OnInit {
  private readonly channels = inject(ChannelAdminService);
  private readonly dialog = inject(MatDialog);

  readonly cols = [
    "channel",
    "triggerPattern",
    "replyText",
    "status",
    "actions",
  ] as const;

  readonly rules = signal<IAutoReplyRuleDto[]>([]);

  ngOnInit(): void {
    this.loadRules();
  }

  openCreate(): void {
    const ref = this.dialog.open(AutoReplyDialogComponent, {
      data: {},
      width: "520px",
    });
    ref.afterClosed().subscribe((result?: IAutoReplyDialogResult) => {
      if (result?.saved) this.loadRules();
    });
  }

  confirmDelete(rule: IAutoReplyRuleDto): void {
    const confirmed = confirm(
      `Delete auto-reply rule for pattern "${rule.triggerPattern}"?`,
    );
    if (!confirmed) return;

    this.channels.deleteAutoReplyRule(rule.id).subscribe({
      next: () => this.loadRules(),
    });
  }

  private loadRules(): void {
    this.channels.listAutoReplyRules().subscribe({
      next: (data) => this.rules.set(data),
    });
  }
}
