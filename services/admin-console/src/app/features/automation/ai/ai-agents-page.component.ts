import { ChangeDetectionStrategy, Component } from "@angular/core";
import { AiComponent } from "./ai.component";

@Component({
  selector: "app-ai-agents-page",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AiComponent],
  template: `
    <app-ai navigationMode="route" defaultMode="list" />
  `,
})
export class AiAgentsPageComponent {}
