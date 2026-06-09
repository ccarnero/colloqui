import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from "@angular/material/dialog";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";

import { StructuredKbService } from "../../../../core/services/structured-kb.service";

export interface ISkbUploadDialogData {
  containerId: string;
}

const SUPPORTED_EXTENSIONS = [".csv", ".xlsx", ".xls"];
const SUPPORTED_MIME_TYPES = [
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];

@Component({
  selector: "app-skb-upload-dialog",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatProgressBarModule,
    MatSnackBarModule,
  ],
  template: `
    <h2 mat-dialog-title>Upload File</h2>

    <mat-dialog-content>
      <p class="text-secondary">Upload a CSV or Excel file to populate your structured knowledge base.</p>

      <div
        class="file-drop-zone"
        (click)="fileInput.click()"
      >
        <mat-icon>cloud_upload</mat-icon>
        <p>
          {{
            selectedFile()
              ? selectedFile()!.name
              : "Click to select a file"
          }}
        </p>
        <p class="text-muted text-xs">Supported formats: CSV, XLSX, XLS</p>
        <input
          #fileInput
          type="file"
          accept=".csv,.xlsx,.xls"
          (change)="onFileChange($event)"
          hidden
        />
      </div>

      @if (selectedFile(); as file) {
        <div class="file-info">
          <mat-icon>description</mat-icon>
          <span>{{ file.name }} ({{ (file.size / 1024).toFixed(1) }} KB)</span>
        </div>
      }

      @if (error(); as err) {
        <div class="error-message">
          <mat-icon>error</mat-icon>
          <span>{{ err }}</span>
        </div>
      }

      @if (uploading()) {
        <div class="progress-section">
          <mat-progress-bar
            mode="determinate"
            [value]="uploadProgress()"
          ></mat-progress-bar>
          <span class="progress-text">{{ uploadProgress() }}%</span>
        </div>
      }

      @if (uploadSuccess()) {
        <div class="success-message">
          <mat-icon>check_circle</mat-icon>
          <span>File uploaded successfully</span>
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="close()">Close</button>
      <button
        mat-raised-button
        color="primary"
        [disabled]="!canUpload()"
        (click)="upload()"
      >
        Upload
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
    .file-drop-zone {
      border: 2px dashed var(--border-subtle);
      border-radius: 12px;
      padding: 32px 16px;
      text-align: center;
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
      margin: 12px 0;
    }
    .file-drop-zone:hover {
      border-color: var(--primary, #7c4dff);
      background: rgba(124, 77, 255, 0.04);
    }
    .file-drop-zone mat-icon {
      font-size: 40px;
      width: 40px;
      height: 40px;
      color: var(--text-muted);
      margin-bottom: 8px;
    }
    .file-drop-zone p { margin: 0; font-size: 14px; color: var(--text-secondary); }
    .file-drop-zone .text-xs { font-size: 11px; margin-top: 4px; }

    .file-info {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: rgba(124, 77, 255, 0.08);
      border-radius: 8px;
      margin-bottom: 8px;
      font-size: 13px;
    }
    .file-info mat-icon { font-size: 20px; width: 20px; height: 20px; color: #7c4dff; }

    .error-message {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: rgba(239, 83, 80, 0.08);
      border-radius: 8px;
      margin-bottom: 8px;
      font-size: 13px;
      color: #ef5350;
    }
    .error-message mat-icon { font-size: 20px; width: 20px; height: 20px; }

    .success-message {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: rgba(102, 187, 106, 0.08);
      border-radius: 8px;
      margin-bottom: 8px;
      font-size: 13px;
      color: #66bb6a;
    }
    .success-message mat-icon { font-size: 20px; width: 20px; height: 20px; }

    .progress-section {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }
    .progress-section mat-progress-bar { flex: 1; }
    .progress-text { font-size: 12px; color: var(--text-secondary); white-space: nowrap; }

    .text-secondary { color: var(--text-secondary); font-size: 13px; }
    .text-muted { color: var(--text-muted); }
  `,
  ],
})
export class SkbUploadDialogComponent {
  private readonly service = inject(StructuredKbService);
  private readonly dialogRef = inject(MatDialogRef<SkbUploadDialogComponent>);
  private readonly snackBar = inject(MatSnackBar);

  readonly data: ISkbUploadDialogData = inject(MAT_DIALOG_DATA);

  readonly selectedFile = signal<File | null>(null);
  readonly uploading = signal(false);
  readonly uploadProgress = signal(0);
  readonly uploadSuccess = signal(false);
  readonly error = signal<string | null>(null);

  readonly canUpload = computed(
    () => this.selectedFile() !== null && !this.uploading(),
  );

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (file) {
      this.onFileSelected(file);
    }
  }

  onFileSelected(file: File): void {
    this.error.set(null);
    this.uploadSuccess.set(false);

    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    const isValidExt = SUPPORTED_EXTENSIONS.includes(ext);
    const isValidMime = SUPPORTED_MIME_TYPES.includes(file.type);

    if (!isValidExt && !isValidMime) {
      this.error.set("Unsupported file type. Accepted: CSV, XLSX, XLS");
      this.selectedFile.set(null);
      return;
    }

    this.selectedFile.set(file);
  }

  upload(): void {
    const file = this.selectedFile();
    if (!file || this.uploading()) return;

    this.uploading.set(true);
    this.uploadProgress.set(0);
    this.error.set(null);
    this.uploadSuccess.set(false);

    // Simulate upload progress
    const interval = setInterval(() => {
      this.uploadProgress.update((p) => Math.min(p + 10, 90));
    }, 200);

    this.service.uploadFile(this.data.containerId, file).subscribe({
      next: () => {
        clearInterval(interval);
        this.uploadProgress.set(100);
        this.uploadSuccess.set(true);
        this.uploading.set(false);
      },
      error: (err) => {
        clearInterval(interval);
        this.error.set(err.message ?? "Upload failed");
        this.uploading.set(false);
      },
    });
  }

  close(): void {
    this.dialogRef.close();
  }
}
