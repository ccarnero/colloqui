import { Component } from "@angular/core";
import { RouterOutlet } from "@angular/router";
import { HeaderComponent } from "../header/header.component";
import { EventFeedComponent } from "../event-feed/event-feed.component";

@Component({
  selector: "app-shell",
  imports: [RouterOutlet, HeaderComponent, EventFeedComponent],
  template: `
    <div class="shell">
      <app-header />
      <div class="shell-body">
        <app-event-feed class="shell-sidebar" />
        <main class="shell-main">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
  styles: `
    .shell {
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    .shell-body {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    .shell-sidebar {
      width: 300px;
      flex-shrink: 0;
      border-right: 1px solid var(--border);
      overflow-y: auto;
    }
    .shell-main {
      flex: 1;
      overflow-y: auto;
      padding: 24px;
    }
    @media (max-width: 768px) {
      .shell-sidebar {
        display: none;
      }
    }
  `,
})
export class ShellComponent {}
