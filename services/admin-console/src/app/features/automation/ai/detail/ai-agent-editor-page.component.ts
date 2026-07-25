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
  // T06 (SPEC decision 5c): the editor is now the mock's single scrolling
  // column (mock 07/08) instead of a fixed 3-pane workstation, so the test
  // panel moves from a docked side pane to the bottom of the SAME scroll
  // (mock 09 shows "Test run" as the last block in the column). The invoke
  // wiring in `AgentTestPanelComponent` and the `<app-ai>` save path are
  // both frozen — only this page's layout (grid -> stacked column) changes.
  imports: [AiComponent, AgentTestPanelComponent],
  template: `
    <div class="editor-layout">
      <div class="editor-pane">
        <app-ai
          navigationMode="route"
          defaultMode="editor"
          [forcedAgentId]="agentId()"
          [hideOwnChrome]="isEmbedded()"
        />
      </div>
      <section class="test-pane" aria-label="Test run">
        <app-agent-test-panel [agentId]="agentId()" />
      </section>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .editor-layout {
      display: flex;
      flex-direction: column;
      gap: var(--rd-space-6, 16px);
      min-height: 0;
    }

    .editor-pane {
      min-width: 0;
    }

    .test-pane {
      min-width: 0;
      display: flex;
      flex-direction: column;
      height: 480px;
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      background: var(--bg2);
      overflow: hidden;
    }
  `,
})
export class AiAgentEditorPageComponent {
  private readonly route = inject(ActivatedRoute);

  private readonly ownId = computed(() =>
    this.route.snapshot.paramMap.get("id")
  );

  protected readonly agentId = computed(() => {
    if (this.ownId()) {
      return this.ownId();
    }

    return this.route.parent?.snapshot.paramMap.get("id") ?? null;
  });

  /**
   * True at `/ai/agents/:id/configure` (nested under AiAgentDetailComponent,
   * `:id` lives on the parent route), false at the standalone
   * `/ai/agents/new` route (own route, no parent wrapper). Forwarded to
   * `<app-ai>` so it suppresses its own top bar only when the detail
   * wrapper's floating chrome (Task B) already owns Save/Reset/Cancel.
   */
  protected readonly isEmbedded = computed(
    () => !this.ownId() && !!this.route.parent?.snapshot.paramMap.get("id")
  );
}
