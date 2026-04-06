import {
  ChangeDetectionStrategy,
  Component,
  input,
  model,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { MonacoEditorModule } from "ngx-monaco-editor-v2";
import type {
  IYoizenclawCredentialProfile,
  IYoizenclawSubagentDraft,
} from "../../../core/models/yoizenclaw.model";

@Component({
  selector: "app-yoizenclaw-agent-config",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MonacoEditorModule,
  ],
  template: `
    @if (section() === "general") {
      <div class="section-card-body">
        <div class="editor-grid">
          <mat-form-field appearance="outline" class="full-span">
            <mat-label>Agent Name</mat-label>
            <input
              matInput
              [(ngModel)]="agentName"
              maxlength="255"
              placeholder="Sales Assistant Agent"
            />
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-span">
            <mat-label>Description</mat-label>
            <input
              matInput
              [(ngModel)]="description"
              maxlength="255"
              placeholder="Short internal description for the team"
            />
          </mat-form-field>

          @if (credentialProfileId()) {
            <mat-form-field appearance="outline">
              <mat-label>LLM Provider</mat-label>
              <input matInput [value]="provider()" disabled />
            </mat-form-field>
          }

          <mat-form-field appearance="outline">
            <mat-label>LLM Model</mat-label>
            <input matInput [(ngModel)]="model" placeholder="gpt-5.4-nano" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Credential Profile</mat-label>
            <mat-select [(ngModel)]="credentialProfileId" (selectionChange)="onCredentialProfileChange()">
              <mat-option [value]="null">No credential profile</mat-option>
              @for (profile of credentialProfiles(); track profile.id) {
                <mat-option [value]="profile.id">
                  {{ profile.name }} · {{ profile.provider }}
                </mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>
        <div class="helper-copy">
          Pick a saved credential profile from settings. The service will
          receive it as <code>model_config.credential_profile_id</code>.
        </div>
      </div>
    }

    @if (section() === "skills") {
      <div class="section-card-body">
        <div class="flex items-center justify-between mb-16">
          <span class="text-muted text-sm">
            Delegate narrow responsibilities to focused skills.
          </span>
          <button class="btn btn-secondary btn-sm" type="button" (click)="addSubagent()">
            <mat-icon>add</mat-icon> Add Skill
          </button>
        </div>

        <div class="subagent-stack">
          @for (subagent of subagents(); track $index) {
            <article class="subagent-card">
              <div class="subagent-header">
                <strong>{{ subagent.name || "New Skill" }}</strong>
                <button
                  class="icon-btn"
                  type="button"
                  aria-label="Remove skill"
                  (click)="removeSubagent($index)"
                >
                  <mat-icon>delete</mat-icon>
                </button>
              </div>

              <div class="subagent-grid">
                <mat-form-field appearance="outline">
                  <mat-label>Name</mat-label>
                  <input matInput [(ngModel)]="subagent.name" placeholder="Lead Qualifier" />
                </mat-form-field>

                <mat-form-field appearance="outline">
                  <mat-label>Description</mat-label>
                  <input
                    matInput
                    [(ngModel)]="subagent.description"
                    placeholder="When this subagent should be used"
                  />
                </mat-form-field>

                <div class="full-span editor-container">
                  <label class="editor-label">System Prompt</label>
                  <ngx-monaco-editor
                    class="prompt-editor-sm"
                    [options]="editorOptions()"
                    [(ngModel)]="subagent.systemPrompt"
                  />
                </div>
              </div>
            </article>
          }
        </div>
      </div>
    }
  `,
  styles: `
    code {
      font-family: "JetBrains Mono", ui-monospace, monospace;
      color: var(--text-primary);
      background: var(--bg3);
      border: 1px solid var(--border-subtle);
      padding: 1px 6px;
      border-radius: 999px;
    }

    .editor-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
    }

    .subagent-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }

    .full-span {
      grid-column: 1 / -1;
    }

    .helper-copy {
      margin-top: 16px;
      color: var(--text3);
      font-size: 12px;
    }

    .subagent-stack {
      display: grid;
      gap: 14px;
    }

    .subagent-card {
      padding: 16px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      background: rgba(255, 255, 255, 0.015);
      transition: all 0.2s ease;
      display: grid;
      gap: 12px;
    }

    .subagent-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      background: transparent;
      color: var(--text3);
      cursor: pointer;
    }

    .icon-btn:hover {
      color: var(--text-primary);
      border-color: var(--border2);
      background: rgba(255, 255, 255, 0.03);
    }

    .editor-container {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .editor-label {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-secondary, rgba(255, 255, 255, 0.7));
    }

    .prompt-editor-sm {
      display: block;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius2);
      overflow: hidden;
      height: 150px;
    }

    .mb-16 {
      margin-bottom: 16px;
    }

    @media (max-width: 1180px) {
      .editor-grid {
        grid-template-columns: 1fr 1fr;
      }
    }

    @media (max-width: 720px) {
      .editor-grid {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class YoizenclawAgentConfigComponent {
  readonly section = input.required<"general" | "skills">();
  readonly credentialProfiles =
    input.required<IYoizenclawCredentialProfile[]>();
  readonly editorOptions = input.required<Record<string, unknown>>();

  readonly agentName = model("");
  readonly description = model("");
  readonly provider = model("");
  readonly model = model("");
  readonly credentialProfileId = model<string | null>(null);

  readonly subagents = model<IYoizenclawSubagentDraft[]>([]);

  /**
   * Auto-select LLM Provider based on the selected Credential Profile.
   * The provider value comes directly from the credential profile API response.
   */
  onCredentialProfileChange(): void {
    const selectedId = this.credentialProfileId();
    if (!selectedId) {
      // If no profile selected, clear the provider
      this.provider.set("");
      return;
    }

    const selectedProfile = this.credentialProfiles().find(
      (p) => p.id === selectedId
    );
    if (selectedProfile) {
      // Use the provider directly from the credential profile
      this.provider.set(selectedProfile.provider);
    }
  }

  addSubagent(): void {
    this.subagents.update((items) => [
      ...items,
      {
        name: "",
        description: "",
        systemPrompt: "",
        enabled: true,
      },
    ]);
  }

  removeSubagent(index: number): void {
    this.subagents.update((items) => items.filter((_, i) => i !== index));
  }
}
