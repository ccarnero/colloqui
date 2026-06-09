import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from "@angular/material/dialog";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { firstValueFrom } from "rxjs";
import {
  KnowledgeBasesService,
  type DocumentContentType,
} from "../../../../core/services/knowledge-bases.service";

export interface IDocumentUploadDialogData {
  knowledgeBaseId: string;
}

export interface IDocumentUploadDialogResult {
  saved: boolean;
}

const CONTENT_TYPE_OPTIONS: { value: DocumentContentType; label: string }[] = [
  { value: "text", label: "Plain Text" },
  { value: "markdown", label: "Markdown" },
];

@Component({
  selector: "app-document-upload-dialog",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSnackBarModule,
  ],
  template: `
    <h2 mat-dialog-title>Upload Document</h2>

    <mat-dialog-content>
      <!-- File upload section -->
      <h3>Upload a file</h3>
      <div
        class="file-drop-zone"
        (click)="fileInput.click()"
        (dragover)="$event.preventDefault()"
        (drop)="onFileDrop($event)"
      >
        <mat-icon>cloud_upload</mat-icon>
        <p>{{ selectedFile() ? selectedFile()!.name : "Click or drag a file here" }}</p>
        <p class="text-muted text-xs">Supports PDF, TXT, MD</p>
        <input
          #fileInput
          type="file"
          accept=".pdf,.txt,.md,.csv,.html"
          (change)="onFileSelected($event)"
          hidden
        />
      </div>

      @if (selectedFile(); as file) {
        <div class="file-info">
          <mat-icon>description</mat-icon>
          <span>{{ file.name }} ({{ (file.size / 1024).toFixed(1) }} KB)</span>
          <button type="button" class="icon-btn-sm" (click)="clearFile()">
            <mat-icon>close</mat-icon>
          </button>
        </div>
      }

      <div class="divider"><span>OR</span></div>

      <!-- Text paste section -->
      <h3>Paste text content</h3>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Filename</mat-label>
        <input matInput [(ngModel)]="filename" placeholder="my-document.txt" />
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Content Type</mat-label>
        <mat-select [(ngModel)]="contentType">
          @for (opt of contentTypeOptions; track opt.value) {
            <mat-option [value]="opt.value">{{ opt.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Content</mat-label>
        <textarea
          matInput
          [(ngModel)]="content"
          rows="8"
          placeholder="Paste your document content here..."
        ></textarea>
      </mat-form-field>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close type="button">Cancel</button>
      <button
        mat-flat-button
        color="primary"
        type="button"
        [disabled]="saving() || (!selectedFile() && (!filename.trim() || !content.trim()))"
        (click)="upload()"
      >
        {{ saving() ? "Uploading..." : "Upload" }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    :host {
      display: block;
      min-width: 420px;
      max-width: 560px;
    }
    mat-dialog-content {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .full-width {
      width: 100%;
    }
    h3 {
      margin: 8px 0 4px;
      font-size: 14px;
      font-weight: 600;
    }
    .file-drop-zone {
      border: 2px dashed var(--border-subtle);
      border-radius: 8px;
      padding: 24px;
      text-align: center;
      cursor: pointer;
      transition: border-color 0.2s;
      margin: 4px 0;
    }
    .file-drop-zone:hover {
      border-color: var(--primary);
    }
    .file-drop-zone mat-icon {
      font-size: 40px;
      width: 40px;
      height: 40px;
      opacity: 0.5;
      margin-bottom: 8px;
    }
    .file-drop-zone p {
      margin: 0;
      font-size: 13px;
      color: var(--text-secondary);
    }
    .file-drop-zone .text-muted {
      font-size: 11px;
      opacity: 0.6;
      margin-top: 4px;
    }
    .file-info {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      background: var(--bg3);
      border-radius: 6px;
      margin-top: 8px;
      font-size: 13px;
    }
    .file-info mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .icon-btn-sm {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      margin-left: auto;
    }
    .icon-btn-sm:hover {
      background: var(--border-subtle);
      color: var(--text-primary);
    }
    .icon-btn-sm mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .divider {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 16px 0;
      color: var(--text-muted);
      font-size: 12px;
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      border-top: 1px solid var(--border-subtle);
    }
  `,
})
export class DocumentUploadDialogComponent {
  private readonly service = inject(KnowledgeBasesService);
  private readonly dialogRef = inject(
    MatDialogRef<
      DocumentUploadDialogComponent,
      IDocumentUploadDialogResult | undefined
    >,
  );
  private readonly data = inject<IDocumentUploadDialogData>(MAT_DIALOG_DATA);
  private readonly snackBar = inject(MatSnackBar);

  readonly contentTypeOptions = CONTENT_TYPE_OPTIONS;
  readonly saving = signal(false);

  readonly selectedFile = signal<File | null>(null);

  filename = "";
  contentType: DocumentContentType = "text";
  content = "";

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      this.selectedFile.set(input.files[0]);
    }
  }

  onFileDrop(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer?.files?.length) {
      this.selectedFile.set(event.dataTransfer.files[0]);
    }
  }

  clearFile(): void {
    this.selectedFile.set(null);
  }

  private computeMimeType(
    filename: string,
    contentType: DocumentContentType,
  ): string {
    if (filename.endsWith(".md")) return "text/markdown";
    if (filename.endsWith(".html")) return "text/html";
    if (filename.endsWith(".csv")) return "text/csv";
    if (filename.endsWith(".pdf")) return "application/pdf";
    return contentType === "markdown" ? "text/markdown" : "text/plain";
  }

  async upload(): Promise<void> {
    this.saving.set(true);

    try {
      const kbId = this.data.knowledgeBaseId;

      if (this.selectedFile()) {
        // File upload mode
        const file = this.selectedFile()!;
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);

        await firstValueFrom(
          this.service.uploadFile(kbId, {
            filename: file.name,
            file_base64: base64,
            content_type: "auto",
          }),
        );
      } else {
        // Text paste mode
        await firstValueFrom(
          this.service.uploadDocument(kbId, {
            original_filename: this.filename.trim(),
            mime_type: this.computeMimeType(
              this.filename.trim(),
              this.contentType,
            ),
            content_type: this.contentType,
            content_text: this.content,
          }),
        );
      }

      this.dialogRef.close({ saved: true });
    } catch (err) {
      this.saving.set(false);
      const message =
        err instanceof Error ? err.message : "Upload failed. Please try again.";
      this.snackBar.open(message, "OK", { duration: 3000 });
    }
  }
}
