import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  type OnInit,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MAT_DIALOG_DATA, MatDialogModule } from "@angular/material/dialog";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatTableModule } from "@angular/material/table";
import { MatTooltipModule } from "@angular/material/tooltip";
import { RegistryService } from "../../../core/services/registry.service";
import type { IServiceRoute } from "../../../core/models/registry.model";

const ALL_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

export interface IRoutesDialogData {
  serviceId: string;
  serviceName: string;
}

@Component({
  selector: "app-routes-dialog",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatCheckboxModule,
    MatTableModule,
    MatTooltipModule,
  ],
  template: `
    <h2 mat-dialog-title>
      Routes for {{ data.serviceName }}
    </h2>
    <mat-dialog-content>
      <div class="add-section">
        <div class="add-row">
          <mat-form-field
            appearance="outline"
            class="path-field"
          >
            <mat-label>Path Prefix</mat-label>
            <input
              matInput
              [(ngModel)]="pathPrefix"
              placeholder="/api/my-path"
              maxlength="255"
            />
            <mat-hint>Must start with /</mat-hint>
          </mat-form-field>

          <mat-checkbox
            [(ngModel)]="isPublic"
            class="flag-check"
          >
            Public
          </mat-checkbox>

          <mat-checkbox
            [(ngModel)]="stripPrefix"
            class="flag-check"
          >
            Strip prefix
          </mat-checkbox>

          <button
            mat-flat-button
            color="primary"
            type="button"
            [disabled]="saving() || !isValidPath()"
            (click)="addRoute()"
          >
            {{ saving() ? "Adding..." : "Add" }}
          </button>
        </div>

        <div class="methods-row">
          <span class="methods-label">Methods:</span>
          @for (m of allMethods; track m) {
            <mat-checkbox
              [checked]="selectedMethods.has(m)"
              (change)="toggleMethod(m)"
            >
              {{ m }}
            </mat-checkbox>
          }
        </div>
      </div>

      @if (routes().length > 0) {
        <table
          mat-table
          [dataSource]="routes()"
          class="full-width"
        >
          <ng-container matColumnDef="pathPrefix">
            <th
              mat-header-cell
              *matHeaderCellDef
              class="col-path"
            >
              Path Prefix
            </th>
            <td mat-cell *matCellDef="let r">
              <code>{{ r.pathPrefix }}</code>
            </td>
          </ng-container>

          <ng-container matColumnDef="methods">
            <th
              mat-header-cell
              *matHeaderCellDef
              class="col-methods"
            >
              Methods
            </th>
            <td mat-cell *matCellDef="let r">
              <span class="method-list">
                {{ r.methods.join(", ") }}
              </span>
            </td>
          </ng-container>

          <ng-container matColumnDef="isPublic">
            <th
              mat-header-cell
              *matHeaderCellDef
              class="col-flag"
            >
              Public
            </th>
            <td mat-cell *matCellDef="let r" class="col-flag">
              {{ r.isPublic ? "Yes" : "No" }}
            </td>
          </ng-container>

          <ng-container matColumnDef="stripPrefix">
            <th
              mat-header-cell
              *matHeaderCellDef
              class="col-flag"
            >
              Strip
            </th>
            <td mat-cell *matCellDef="let r" class="col-flag">
              {{ r.stripPrefix ? "Yes" : "No" }}
            </td>
          </ng-container>

          <ng-container matColumnDef="actions">
            <th
              mat-header-cell
              *matHeaderCellDef
              class="col-actions"
            ></th>
            <td mat-cell *matCellDef="let r">
              <button
                mat-icon-button
                color="warn"
                type="button"
                aria-label="Delete route"
                matTooltip="Delete route"
                (click)="removeRoute(r)"
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
            *matRowDef="
              let row;
              columns: displayedColumns
            "
          ></tr>
        </table>
      } @else if (!loading()) {
        <div class="empty-state">
          No routes configured for this service.
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">
        Close
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    :host {
      display: block;
      overflow: hidden;
    }
    .full-width {
      width: 100%;
      table-layout: fixed;
    }
    .add-section {
      margin-bottom: 16px;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius2, 6px);
      background: var(--bg2);
    }
    .add-row {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .path-field {
      flex: 1 1 200px;
    }
    .flag-check {
      white-space: nowrap;
    }
    .methods-row {
      display: flex;
      align-items: center;
      gap: 4px 8px;
      flex-wrap: wrap;
      margin-top: 4px;
    }
    .methods-row mat-checkbox {
      font-size: 12px;
    }
    .methods-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--text2);
      margin-right: 4px;
    }
    .method-list {
      font-size: 12px;
      font-family: "JetBrains Mono", "Fira Code", monospace;
      word-break: break-word;
    }
    code {
      font-size: 13px;
      font-family: "JetBrains Mono", "Fira Code", monospace;
      background: var(--bg3);
      padding: 2px 6px;
      border-radius: 4px;
      word-break: break-all;
    }
    .col-path {
      width: 35%;
    }
    .col-methods {
      width: 35%;
    }
    .col-flag {
      width: 10%;
      text-align: center;
    }
    .col-actions {
      width: 10%;
    }
    .empty-state {
      text-align: center;
      padding: 24px;
      color: var(--text3);
      font-size: 14px;
    }
  `,
})
export class RoutesDialogComponent implements OnInit {
  private readonly registryService = inject(RegistryService);
  protected readonly data = inject<IRoutesDialogData>(MAT_DIALOG_DATA);

  readonly routes = signal<IServiceRoute[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);

  readonly allMethods = ALL_METHODS;
  readonly selectedMethods = new Set<string>(ALL_METHODS);

  readonly displayedColumns = [
    "pathPrefix",
    "methods",
    "isPublic",
    "stripPrefix",
    "actions",
  ];

  pathPrefix = "";
  isPublic = false;
  stripPrefix = true;

  ngOnInit(): void {
    this.loadRoutes();
  }

  isValidPath(): boolean {
    const trimmed = this.pathPrefix.trim();
    return trimmed.length > 0 && trimmed.startsWith("/");
  }

  toggleMethod(method: string): void {
    if (this.selectedMethods.has(method)) {
      this.selectedMethods.delete(method);
    } else {
      this.selectedMethods.add(method);
    }
  }

  addRoute(): void {
    if (!this.isValidPath()) {
      return;
    }

    this.saving.set(true);
    const methods =
      this.selectedMethods.size === ALL_METHODS.length
        ? undefined
        : [...this.selectedMethods];

    this.registryService
      .createRoute(this.data.serviceId, {
        pathPrefix: this.pathPrefix.trim(),
        methods,
        isPublic: this.isPublic,
        stripPrefix: this.stripPrefix,
      })
      .subscribe({
        next: () => {
          this.pathPrefix = "";
          this.isPublic = false;
          this.stripPrefix = true;
          this.selectedMethods.clear();
          for (const m of ALL_METHODS) {
            this.selectedMethods.add(m);
          }
          this.saving.set(false);
          this.loadRoutes();
        },
        error: () => this.saving.set(false),
      });
  }

  removeRoute(route: IServiceRoute): void {
    this.registryService.deleteRoute(this.data.serviceId, route.id).subscribe({
      next: () => this.loadRoutes(),
    });
  }

  private loadRoutes(): void {
    this.loading.set(true);
    this.registryService.listRoutes(this.data.serviceId).subscribe({
      next: (data) => {
        this.routes.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
