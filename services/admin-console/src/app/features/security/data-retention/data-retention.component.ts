import { ChangeDetectionStrategy, Component, signal } from "@angular/core";
import { MatSlideToggleModule } from "@angular/material/slide-toggle";
import { MatTableModule } from "@angular/material/table";

interface IRetentionRow {
  dataType: string;
  period: string;
  enabled: boolean;
}

@Component({
  selector: "app-data-retention",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatTableModule, MatSlideToggleModule],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Data Retention</div>
        <div class="ws-subtitle">Control how long each data class is stored</div>
      </div>
    </div>

    <div class="table-wrap">
      <table mat-table [dataSource]="policies()">
        <ng-container matColumnDef="dataType">
          <th mat-header-cell *matHeaderCellDef>Data type</th>
          <td mat-cell *matCellDef="let r">{{ r.dataType }}</td>
        </ng-container>
        <ng-container matColumnDef="period">
          <th mat-header-cell *matHeaderCellDef>Retention period</th>
          <td mat-cell *matCellDef="let r" style="font-family:monospace">
            {{ r.period }}
          </td>
        </ng-container>
        <ng-container matColumnDef="enabled">
          <th mat-header-cell *matHeaderCellDef>Enforced</th>
          <td mat-cell *matCellDef="let r; let i = index">
            <mat-slide-toggle
              [checked]="r.enabled"
              (change)="toggle(i, $event.checked)"
            />
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="cols"></tr>
        <tr mat-row *matRowDef="let row; columns: cols"></tr>
      </table>
    </div>
  `,
})
export class DataRetentionComponent {
  readonly cols = ["dataType", "period", "enabled"] as const;

  readonly policies = signal<IRetentionRow[]>([
    { dataType: "Audit logs", period: "400 days", enabled: true },
    { dataType: "Application logs", period: "90 days", enabled: true },
    { dataType: "User sessions", period: "30 days", enabled: true },
    { dataType: "Exports & downloads", period: "14 days", enabled: false },
    { dataType: "Backups", period: "1 year", enabled: true },
  ]);

  toggle(index: number, enabled: boolean): void {
    this.policies.update((rows) =>
      rows.map((r, i) => (i === index ? { ...r, enabled } : r)),
    );
  }
}
