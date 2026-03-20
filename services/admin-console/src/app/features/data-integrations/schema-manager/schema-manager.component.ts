import { Component, signal } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatTableModule } from "@angular/material/table";

interface SchemaTableRow {
  name: string;
  columns: number;
  indexes: number;
  rows: string;
}

@Component({
  selector: "app-schema-manager",
  standalone: true,
  imports: [MatTableModule, MatButtonModule, MatIconModule],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Schema Manager</div>
        <div class="ws-subtitle">Inspect tables, columns, and indexes</div>
      </div>
      <div class="ws-actions">
        <button type="button" class="btn btn-secondary btn-sm">Refresh</button>
      </div>
    </div>

    <div class="table-wrap">
      <table mat-table [dataSource]="tables()">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Table</th>
          <td mat-cell *matCellDef="let t" style="font-family:monospace">
            {{ t.name }}
          </td>
        </ng-container>
        <ng-container matColumnDef="columns">
          <th mat-header-cell *matHeaderCellDef>Columns</th>
          <td mat-cell *matCellDef="let t">{{ t.columns }}</td>
        </ng-container>
        <ng-container matColumnDef="indexes">
          <th mat-header-cell *matHeaderCellDef>Indexes</th>
          <td mat-cell *matCellDef="let t">{{ t.indexes }}</td>
        </ng-container>
        <ng-container matColumnDef="rows">
          <th mat-header-cell *matHeaderCellDef>Rows (est.)</th>
          <td mat-cell *matCellDef="let t">{{ t.rows }}</td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="cols"></tr>
        <tr mat-row *matRowDef="let row; columns: cols"></tr>
      </table>
    </div>
  `,
})
export class SchemaManagerComponent {
  readonly cols = ["name", "columns", "indexes", "rows"] as const;

  readonly tables = signal<SchemaTableRow[]>([
    { name: "public.users", columns: 14, indexes: 4, rows: "42.1K" },
    { name: "public.sessions", columns: 9, indexes: 3, rows: "128K" },
    { name: "public.audit_events", columns: 11, indexes: 5, rows: "3.4M" },
    { name: "billing.invoices", columns: 18, indexes: 6, rows: "12.8K" },
    { name: "analytics.events", columns: 22, indexes: 8, rows: "890M" },
  ]);
}
