import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { SkillsService, type ISkill } from "../../../../core/services/skills.service";

@Component({
  selector: "app-skill-picker-dialog",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatDialogModule, MatCheckboxModule],
  template: `
    <h2 mat-dialog-title>Add Skills from Catalog</h2>
    <mat-dialog-content>
      @if (loading()) {
        <div class="loading">Loading skills...</div>
      }
      @if (error()) {
        <div class="error">{{ error() }}</div>
      }
      <div class="skill-list">
        @for (skill of skills(); track skill.id) {
          <label class="skill-row" [class.selected]="selected().has(skill.id)">
            <mat-checkbox
              [checked]="selected().has(skill.id)"
              (change)="toggleSkill(skill.id)"
              [color]="'primary'"
            />
            <div class="skill-info">
              <span class="skill-name">{{ skill.name }}</span>
              <span class="skill-desc">{{ skill.description }}</span>
            </div>
          </label>
        } @empty {
          @if (!loading()) {
            <div class="empty">No skills in catalog. Create some in AI > Skills first.</div>
          }
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-button color="primary" [disabled]="selected().size === 0" [mat-dialog-close]="getSelectedSkills()">
        Add Selected ({{ selected().size }})
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .skill-list { display: flex; flex-direction: column; gap: 4px; min-height: 200px; max-height: 400px; overflow-y: auto; padding: 4px 0; }
    .skill-row {
      display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 8px;
      cursor: pointer; border: 1px solid var(--border-subtle); transition: all 0.15s;
    }
    .skill-row:hover { border-color: var(--primary); background: rgba(66,165,245,0.04); }
    .skill-row.selected { border-color: var(--primary); background: rgba(66,165,245,0.08); }
    .skill-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .skill-name { font-weight: 500; font-size: 14px; }
    .skill-desc { font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .loading, .error, .empty { text-align: center; padding: 40px; color: var(--text-muted); }
    .error { color: #ef5350; }
  `],
})
export class SkillPickerDialogComponent {
  private readonly skillsService = inject(SkillsService);
  private readonly dialogRef = inject(MatDialogRef<SkillPickerDialogComponent>);

  readonly skills = signal<ISkill[]>([]);
  readonly loading = signal(true);
  readonly error = signal("");
  readonly selected = signal<Set<string>>(new Set());

  constructor() {
    this.skillsService.list().subscribe({
      next: (res) => {
        this.skills.set(res.skills || []);
        this.loading.set(false);
      },
      error: () => {
        this.error.set("Failed to load skills catalog.");
        this.loading.set(false);
      },
    });
  }

  toggleSkill(id: string): void {
    this.selected.update((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  getSelectedSkills(): { id: string; name: string }[] {
    return this.skills()
      .filter((s) => this.selected().has(s.id))
      .map((s) => ({ id: s.id, name: s.name }));
  }
}
