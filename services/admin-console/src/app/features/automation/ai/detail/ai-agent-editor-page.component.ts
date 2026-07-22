import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { AiComponent } from "../ai.component";
import { AgentTestPanelComponent } from "./agent-test-panel.component";

@Component({
  selector: "app-ai-agent-editor-page",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Test panel is placed here (not restructuring ai.component.ts's inline
  // @switch template) as the smaller diff that still satisfies decision 3
  // (editor + test panel side by side in the agent editor view) — this page
  // already wraps <app-ai> as the sole editor host for both agents/new and
  // agents/:id/configure routes.
  imports: [AiComponent, AgentTestPanelComponent],
  template: `
    <div class="editor-layout">
      <div class="editor-pane">
        <app-ai
          navigationMode="route"
          defaultMode="editor"
          [forcedAgentId]="agentId()"
        />
      </div>
      <aside class="test-pane">
        <app-agent-test-panel [agentId]="agentId()" />
      </aside>
    </div>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }

    .editor-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(320px, 380px);
      gap: 12px;
      height: 100%;
      min-height: 0;
    }

    .editor-pane {
      min-width: 0;
      min-height: 0;
    }

    .test-pane {
      min-height: 0;
      position: sticky;
      top: 12px;
      align-self: start;
      height: calc(100dvh - 180px);
    }

    @media (max-width: 1180px) {
      .editor-layout {
        grid-template-columns: 1fr;
      }

      .test-pane {
        height: 480px;
        position: static;
      }
    }
  `,
})
export class AiAgentEditorPageComponent {
  private readonly route = inject(ActivatedRoute);

  protected readonly agentId = computed(() => {
    const ownId = this.route.snapshot.paramMap.get("id");
    if (ownId) {
      return ownId;
    }

    return this.route.parent?.snapshot.paramMap.get("id") ?? null;
  });
}
