import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { YoizenclawComponent } from "../yoizenclaw.component";

@Component({
  selector: "app-yoizenclaw-agent-editor-page",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [YoizenclawComponent],
  template: `
    <app-yoizenclaw
      navigationMode="route"
      defaultMode="editor"
      [forcedAgentId]="agentId()"
    />
  `,
})
export class YoizenclawAgentEditorPageComponent {
  private readonly route = inject(ActivatedRoute);

  protected readonly agentId = computed(() => {
    const ownId = this.route.snapshot.paramMap.get("id");
    if (ownId) {
      return ownId;
    }

    return this.route.parent?.snapshot.paramMap.get("id") ?? null;
  });
}
