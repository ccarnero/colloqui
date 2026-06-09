import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { AiComponent } from "../ai.component";

@Component({
  selector: "app-ai-agent-editor-page",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AiComponent],
  template: `
    <app-ai
      navigationMode="route"
      defaultMode="editor"
      [forcedAgentId]="agentId()"
    />
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
