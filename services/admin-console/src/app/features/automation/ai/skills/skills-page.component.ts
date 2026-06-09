import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import {
  SkillsService,
  type ISkill,
} from "../../../../core/services/skills.service";
import {
  SkillFormDialogComponent,
  type ISkillFormResult,
} from "./skill-form-dialog.component";

@Component({
  selector: "app-skills-page",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="skills-page">
      <div class="page-header">
        <div>
          <h1>Skills</h1>
          <p class="text-secondary">Manage reusable skill definitions for your agents</p>
        </div>
        <button class="btn btn-primary btn-sm" (click)="createSkill()">
          <mat-icon>add</mat-icon> New Skill
        </button>
      </div>

      <div class="skills-grid">
        @for (skill of skills(); track skill.id) {
          <div
            class="skill-card"
            [style.border-left-color]="skill.color || '#42a5f5'"
          >
            <div class="skill-header">
              <span
                class="skill-icon"
                [style.background]="(skill.color || '#42a5f5') + '20'"
              >
                <mat-icon [style.color]="skill.color">{{
                  skill.icon || "smart_toy"
                }}</mat-icon>
              </span>
              <div class="skill-info">
                <strong>{{ skill.name }}</strong>
                <span class="skill-desc">{{ skill.description }}</span>
              </div>
            </div>
            <div class="skill-prompt">
              {{ skill.system_prompt.slice(0, 120) }}{{ skill.system_prompt.length > 120 ? "..." : "" }}
            </div>
            <div class="skill-footer">
              <div class="skill-tags">
                @for (cmd of (skill.trigger_commands || []).slice(0, 3); track cmd) {
                  <span class="skill-tag">{{ cmd }}</span>
                }
              </div>
              <div class="skill-actions">
                <button
                  class="icon-btn"
                  (click)="editSkill(skill)"
                  title="Edit"
                >
                  <mat-icon>edit</mat-icon>
                </button>
                <button
                  class="icon-btn danger"
                  (click)="deleteSkill(skill)"
                  title="Delete"
                >
                  <mat-icon>delete</mat-icon>
                </button>
              </div>
            </div>
          </div>
        } @empty {
          <div class="empty-state">
            <mat-icon>psychology</mat-icon>
            <p>No skills yet. Create your first one!</p>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
    .skills-page { padding: 24px; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
    .page-header h1 { margin: 0; font-size: 24px; }
    .skills-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
    .skill-card {
      background: var(--bg2); border: 1px solid var(--border-subtle); border-radius: 12px;
      border-left: 4px solid #42a5f5; padding: 16px; display: flex; flex-direction: column; gap: 12px;
    }
    .skill-header { display: flex; align-items: center; gap: 12px; }
    .skill-icon {
      width: 40px; height: 40px; border-radius: 10px; display: flex;
      align-items: center; justify-content: center; flex-shrink: 0;
    }
    .skill-icon mat-icon { font-size: 22px; width: 22px; height: 22px; }
    .skill-info { display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
    .skill-info strong { font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .skill-desc { font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .skill-prompt { font-size: 12px; color: var(--text-muted); line-height: 1.5; background: var(--bg3); padding: 8px; border-radius: 6px; font-family: monospace; }
    .skill-footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .skill-tags { display: flex; gap: 4px; flex-wrap: wrap; }
    .skill-tag { padding: 2px 8px; border-radius: 4px; font-size: 11px; background: rgba(66, 165, 245, 0.12); color: #42a5f5; font-family: monospace; }
    .skill-actions { display: flex; gap: 4px; flex-shrink: 0; }
    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;
      border: 1px solid var(--border-subtle); border-radius: 8px; background: transparent;
      color: var(--text-muted); cursor: pointer;
    }
    .icon-btn:hover { color: var(--text-primary); border-color: var(--border2); }
    .icon-btn.danger:hover { color: #ef5350; border-color: #ef5350; }
    .empty-state { grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted); }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; margin-bottom: 12px; opacity: 0.5; }
  `,
  ],
})
export class SkillsPageComponent implements OnInit {
  private readonly skillsService = inject(SkillsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly skills = signal<ISkill[]>([]);

  ngOnInit(): void {
    this.loadSkills();
  }

  private loadSkills(): void {
    this.skillsService.list().subscribe({
      next: (res) => this.skills.set(res.skills),
      error: () =>
        this.snackBar.open("Failed to load skills", "OK", { duration: 3000 }),
    });
  }

  createSkill(): void {
    const ref = this.dialog.open(SkillFormDialogComponent, {
      width: "600px",
      data: null,
    });
    ref.afterClosed().subscribe((result: ISkillFormResult | undefined) => {
      if (result) {
        this.skillsService.create(result).subscribe({
          next: () => {
            this.loadSkills();
            this.snackBar.open("Skill created", "OK", { duration: 2000 });
          },
          error: () =>
            this.snackBar.open("Failed to create skill", "OK", {
              duration: 3000,
            }),
        });
      }
    });
  }

  editSkill(skill: ISkill): void {
    const ref = this.dialog.open(SkillFormDialogComponent, {
      width: "600px",
      data: skill,
    });
    ref.afterClosed().subscribe((result: ISkillFormResult | undefined) => {
      if (result) {
        this.skillsService.update(skill.id, result).subscribe({
          next: () => {
            this.loadSkills();
            this.snackBar.open("Skill updated", "OK", { duration: 2000 });
          },
          error: () =>
            this.snackBar.open("Failed to update skill", "OK", {
              duration: 3000,
            }),
        });
      }
    });
  }

  deleteSkill(skill: ISkill): void {
    if (!confirm(`Delete skill "${skill.name}"?`)) return;
    this.skillsService.delete(skill.id).subscribe({
      next: () => {
        this.loadSkills();
        this.snackBar.open("Skill deleted", "OK", { duration: 2000 });
      },
      error: () =>
        this.snackBar.open("Failed to delete skill", "OK", { duration: 3000 }),
    });
  }
}
