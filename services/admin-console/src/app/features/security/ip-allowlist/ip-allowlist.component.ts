import { Component, signal } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatTableModule } from "@angular/material/table";
import { StatusBadgeComponent } from "../../../shared/components/status-badge/status-badge.component";

interface AllowlistRow {
  cidr: string;
  label: string;
  flag: string;
  city: string;
  added: string;
  status: string;
}

@Component({
  selector: "app-ip-allowlist",
  standalone: true,
  imports: [MatTableModule, MatButtonModule, MatIconModule, StatusBadgeComponent],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">IP Allow List</div>
        <div class="ws-subtitle">Restrict admin access by IP or CIDR</div>
      </div>
      <div class="ws-actions">
        <button type="button" class="btn btn-primary btn-sm">+ Add entry</button>
      </div>
    </div>

    <div class="table-wrap">
      <table mat-table [dataSource]="entries()">
        <ng-container matColumnDef="cidr">
          <th mat-header-cell *matHeaderCellDef>IP / CIDR</th>
          <td mat-cell *matCellDef="let r" style="font-family:monospace">
            {{ r.cidr }}
          </td>
        </ng-container>
        <ng-container matColumnDef="label">
          <th mat-header-cell *matHeaderCellDef>Label</th>
          <td mat-cell *matCellDef="let r">{{ r.label }}</td>
        </ng-container>
        <ng-container matColumnDef="flag">
          <th mat-header-cell *matHeaderCellDef>Country</th>
          <td mat-cell *matCellDef="let r" aria-hidden="true">{{ r.flag }}</td>
        </ng-container>
        <ng-container matColumnDef="city">
          <th mat-header-cell *matHeaderCellDef>City</th>
          <td mat-cell *matCellDef="let r">{{ r.city }}</td>
        </ng-container>
        <ng-container matColumnDef="added">
          <th mat-header-cell *matHeaderCellDef>Added</th>
          <td mat-cell *matCellDef="let r" style="font-family:monospace">
            {{ r.added }}
          </td>
        </ng-container>
        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Status</th>
          <td mat-cell *matCellDef="let r">
            <app-status-badge [status]="r.status" />
          </td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let r; let i = index">
            <button
              type="button"
              mat-icon-button
              aria-label="Remove entry"
              (click)="remove(i)"
            >
              <mat-icon>delete</mat-icon>
            </button>
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="cols"></tr>
        <tr mat-row *matRowDef="let row; columns: cols"></tr>
      </table>
    </div>
  `,
})
export class IpAllowlistComponent {
  readonly cols = [
    "cidr",
    "label",
    "flag",
    "city",
    "added",
    "status",
    "actions",
  ] as const;

  readonly entries = signal<AllowlistRow[]>([
    {
      cidr: "203.0.113.0/24",
      label: "HQ egress",
      flag: "🇺🇸",
      city: "Austin, TX",
      added: "2025-01-12",
      status: "active",
    },
    {
      cidr: "198.51.100.10/32",
      label: "VPN gateway",
      flag: "🇩🇪",
      city: "Frankfurt",
      added: "2024-11-03",
      status: "active",
    },
    {
      cidr: "10.8.0.0/16",
      label: "Private mesh",
      flag: "—",
      city: "Internal",
      added: "2024-09-20",
      status: "active",
    },
    {
      cidr: "192.0.2.50/32",
      label: "Contractor (expired)",
      flag: "🇬🇧",
      city: "London",
      added: "2024-06-01",
      status: "revoked",
    },
  ]);

  remove(index: number): void {
    this.entries.update((rows) => rows.filter((_, i) => i !== index));
  }
}
