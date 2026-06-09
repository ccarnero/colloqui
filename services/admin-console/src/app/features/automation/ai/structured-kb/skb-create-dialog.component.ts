import { Component, inject } from "@angular/core";
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
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";

import { StructuredKbService } from "../../../../core/services/structured-kb.service";

@Component({
  selector: "app-skb-create-dialog",
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSnackBarModule,
  ],
  template: `
    <h2 mat-dialog-title>Create Structured KB</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Name</mat-label>
        <input matInput [(ngModel)]="name" placeholder="My Knowledge Base" />
      </mat-form-field>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Description (optional)</mat-label>
        <input matInput [(ngModel)]="description" placeholder="Describe the data..." />
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="cancel()">Cancel</button>
      <button
        mat-raised-button
        color="primary"
        [disabled]="!name.trim()"
        (click)="save()"
      >
        Create
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .full-width { width: 100%; margin-bottom: 8px; }
  `],
})
export class SkbCreateDialogComponent {
  private readonly service = inject(StructuredKbService);
  private readonly dialogRef = inject(MatDialogRef<SkbCreateDialogComponent>);
  private readonly snackBar = inject(MatSnackBar);

  readonly data: { containerId?: string } = inject(MAT_DIALOG_DATA);

  name = "";
  description = "";

  cancel(): void {
    this.dialogRef.close();
  }

  save(): void {
    if (!this.name.trim()) return;
    this.service.createContainer({ name: this.name.trim(), description: this.description.trim() || undefined }).subscribe({
      next: () => {
        this.snackBar.open("Knowledge base created", "OK", { duration: 2000 });
        this.dialogRef.close({ saved: true });
      },
      error: () => {
        this.snackBar.open("Failed to create knowledge base", "OK", { duration: 3000 });
      },
    });
  }
}
