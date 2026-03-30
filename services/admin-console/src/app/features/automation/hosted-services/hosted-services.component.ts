import { Component, inject, type OnInit } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatTableModule } from "@angular/material/table";
import { MatTooltipModule } from "@angular/material/tooltip";
import { RegistryService } from "../../../core/services/registry.service";
import { TenantService } from "../../../core/services/tenant.service";
import {
  StatusBadgeComponent,
  type StatusBadgeColor,
} from "../../../shared/components/status-badge/status-badge.component";
import type { IRegisteredService } from "../../../core/models/registry.model";
import {
  ServiceDialogComponent,
  type ServiceDialogData,
  type ServiceDialogResult,
} from "./service-dialog.component";
import {
  RoutesDialogComponent,
  type RoutesDialogData,
} from "./routes-dialog.component";

@Component({
  selector: "app-hosted-services",
  imports: [
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatTooltipModule,
    StatusBadgeComponent,
  ],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Hosted Services</div>
        <div class="ws-subtitle">
          Manage registered services for
          {{ tenant.currentTenant().name }}
        </div>
      </div>
      <div class="ws-actions">
        <button
          class="btn btn-primary btn-sm"
          type="button"
          (click)="openCreateDialog()"
        >
          + Register Service
        </button>
      </div>
    </div>

    <div class="section-card">
      <table
        mat-table
        [dataSource]="registryService.services()"
        class="full-width"
      >
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Name</th>
          <td mat-cell *matCellDef="let s">
            <strong>{{ s.name }}</strong>
            <div class="muted mono">{{ s.knativeName }}</div>
          </td>
        </ng-container>

        <ng-container matColumnDef="image">
          <th mat-header-cell *matHeaderCellDef>Image</th>
          <td mat-cell *matCellDef="let s">
            <span
              class="mono truncate"
              [matTooltip]="s.image"
            >
              {{ s.image }}
            </span>
          </td>
        </ng-container>

        <ng-container matColumnDef="port">
          <th mat-header-cell *matHeaderCellDef>Port</th>
          <td mat-cell *matCellDef="let s">{{ s.port }}</td>
        </ng-container>

        <ng-container matColumnDef="scaling">
          <th mat-header-cell *matHeaderCellDef>Scaling</th>
          <td mat-cell *matCellDef="let s">
            <span class="scaling-range">
              {{ s.minScale }} &ndash; {{ s.maxScale }}
            </span>
            <div class="muted">
              concurrency {{ s.concurrencyTarget }}
            </div>
          </td>
        </ng-container>

        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Status</th>
          <td mat-cell *matCellDef="let s">
            <app-status-badge
              [status]="s.status"
              [color]="statusColor(s.status)"
            />
          </td>
        </ng-container>

        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let s">
            <button
              mat-icon-button
              type="button"
              aria-label="Edit service"
              matTooltip="Edit"
              (click)="openEditDialog(s)"
            >
              <mat-icon>edit</mat-icon>
            </button>
            <button
              mat-icon-button
              color="warn"
              type="button"
              aria-label="Delete service"
              matTooltip="Delete"
              (click)="deleteService(s)"
            >
              <mat-icon>delete</mat-icon>
            </button>
          </td>
        </ng-container>

        <tr
          mat-header-row
          *matHeaderRowDef="displayedColumns"
        ></tr>
        <tr
          mat-row
          *matRowDef="let row; columns: displayedColumns"
        ></tr>
      </table>
    </div>
  `,
  styles: `
    .full-width {
      width: 100%;
    }
    .muted {
      font-size: 12px;
      color: var(--text3);
      margin-top: 2px;
    }
    .mono {
      font-family: "JetBrains Mono", "Fira Code", monospace;
      font-size: 12px;
    }
    .truncate {
      display: inline-block;
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      vertical-align: middle;
    }
    .scaling-range {
      font-weight: 600;
      font-size: 13px;
    }
  `,
})
export class HostedServicesComponent implements OnInit {
  private readonly dialog = inject(MatDialog);
  protected readonly registryService = inject(RegistryService);
  protected readonly tenant = inject(TenantService);

  readonly displayedColumns = [
    "name",
    "image",
    "port",
    "scaling",
    "status",
    "actions",
  ];

  ngOnInit(): void {
    this.registryService.loadServices();
  }

  statusColor(status: string): StatusBadgeColor {
    if (status === "active") {
      return "green";
    }
    if (status === "pending") {
      return "yellow";
    }
    if (status === "error") {
      return "red";
    }
    return "gray";
  }

  openCreateDialog(): void {
    const data: ServiceDialogData = {};
    const ref = this.dialog.open(ServiceDialogComponent, {
      width: "640px",
      data,
    });

    ref
      .afterClosed()
      .subscribe((result?: ServiceDialogResult) => {
        if (result?.saved) {
          this.registryService.loadServices();
        }
      });
  }

  openEditDialog(service: IRegisteredService): void {
    this.registryService
      .getService(service.id)
      .subscribe((detail) => {
        const data: ServiceDialogData = { service: detail };
        const ref = this.dialog.open(
          ServiceDialogComponent,
          { width: "640px", data },
        );

        ref
          .afterClosed()
          .subscribe((result?: ServiceDialogResult) => {
            if (result?.saved) {
              this.registryService.loadServices();
            }
          });
      });
  }

  openRoutesDialog(service: IRegisteredService): void {
    const data: RoutesDialogData = {
      serviceId: service.id,
      serviceName: service.name,
    };
    this.dialog.open(RoutesDialogComponent, {
      width: "1000px",
      maxWidth: "95vw",
      data,
    });
  }

  deleteService(service: IRegisteredService): void {
    this.registryService.deleteService(service.id);
  }
}
