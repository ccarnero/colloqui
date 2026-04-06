import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from "@angular/core";
import { NotificationService } from "../../../core/services/notification.service";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";

type ExportFormat = "json" | "csv" | "parquet";

@Component({
  selector: "app-data-export",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <div class="ws-header">
      <div>
        <div class="ws-title">Data Export</div>
        <div class="ws-subtitle">Export datasets in your preferred format</div>
      </div>
    </div>

    <div class="export-formats">
      @for (f of formats; track f.id) {
        <mat-card
          class="format-card"
          [class.selected]="selectedFormat() === f.id"
          (click)="selectedFormat.set(f.id)"
          (keydown.enter)="selectedFormat.set(f.id)"
          (keydown.space)="$event.preventDefault(); selectedFormat.set(f.id)"
          tabindex="0"
          role="button"
          [attr.aria-pressed]="selectedFormat() === f.id"
        >
          <mat-card-header>
            <mat-icon mat-card-avatar>{{ f.icon }}</mat-icon>
            <mat-card-title>{{ f.label }}</mat-card-title>
            <mat-card-subtitle>{{ f.description }}</mat-card-subtitle>
          </mat-card-header>
        </mat-card>
      }
    </div>

    <div class="export-range">
      <mat-form-field appearance="outline">
        <mat-label>Start date</mat-label>
        <input matInput type="date" [value]="startDate()" (input)="onStart($event)" />
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>End date</mat-label>
        <input matInput type="date" [value]="endDate()" (input)="onEnd($event)" />
      </mat-form-field>
    </div>

    <div class="export-actions">
      <button
        type="button"
        class="btn btn-primary"
        (click)="export()"
        [disabled]="!canExport()"
      >
        Export {{ summary() }}
      </button>
    </div>
  `,
  styles: `
    .export-formats {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .format-card {
      cursor: pointer;
      outline-offset: 2px;
    }
    .format-card.selected {
      box-shadow: 0 0 0 2px var(--cyan, #0ea5e9);
    }
    .export-range {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .export-range mat-form-field {
      min-width: 200px;
    }
  `,
})
export class DataExportComponent {
  private readonly notifications = inject(NotificationService);
  readonly formats: ReadonlyArray<{
    id: ExportFormat;
    label: string;
    description: string;
    icon: string;
  }> = [
    {
      id: "json",
      label: "JSON",
      description: "Structured documents",
      icon: "data_object",
    },
    {
      id: "csv",
      label: "CSV",
      description: "Spreadsheet-friendly",
      icon: "table_chart",
    },
    {
      id: "parquet",
      label: "Parquet",
      description: "Columnar analytics",
      icon: "view_column",
    },
  ];

  readonly selectedFormat = signal<ExportFormat>("json");
  readonly startDate = signal("2025-03-01");
  readonly endDate = signal("2025-03-20");

  readonly summary = computed(() => {
    const fmt = this.selectedFormat();
    const label = this.formats.find((x) => x.id === fmt)?.label ?? fmt;
    return `(${label}, ${this.startDate()} → ${this.endDate()})`;
  });

  readonly canExport = computed(() => {
    const s = this.startDate();
    const e = this.endDate();
    return s.length > 0 && e.length > 0 && s <= e;
  });

  onStart(ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    this.startDate.set(v);
  }

  onEnd(ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    this.endDate.set(v);
  }

  export(): void {
    if (!this.canExport()) {
      return;
    }
    const fmt = this.selectedFormat();
    const label = this.formats.find((x) => x.id === fmt)?.label ?? fmt;
    this.notifications.push({
      color: "primary",
      text: `Export queued (${label}, ${this.startDate()} → ${this.endDate()})`,
      time: new Date().toISOString(),
    });
  }
}
