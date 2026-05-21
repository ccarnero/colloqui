import { ChangeDetectionStrategy, Component } from "@angular/core";
import { YoizenclawComponent } from "./yoizenclaw.component";

@Component({
  selector: "app-yoizenclaw-agents-page",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [YoizenclawComponent],
  template: `
    <app-yoizenclaw navigationMode="route" defaultMode="list" />
  `,
})
export class YoizenclawAgentsPageComponent {}
