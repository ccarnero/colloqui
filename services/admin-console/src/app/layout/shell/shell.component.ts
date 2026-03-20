import { Component, inject, type OnInit } from "@angular/core";
import { RouterOutlet } from "@angular/router";
import { HeaderComponent } from "../header/header.component";
import { SidebarComponent } from "../sidebar/sidebar.component";
import { RightPanelComponent } from "../right-panel/right-panel.component";
import { TenantService } from "../../core/services/tenant.service";

@Component({
  selector: "app-shell",
  imports: [RouterOutlet, HeaderComponent, SidebarComponent, RightPanelComponent],
  template: `
    <app-header />
    <div class="layout">
      <app-sidebar />
      <main class="workspace">
        <router-outlet />
      </main>
      <app-right-panel class="right-panel" />
    </div>
  `,
  styles: `
    :host {
      display: block;
      height: 100vh;
      overflow: hidden;
    }

    .layout {
      display: grid;
      grid-template-columns: 220px 1fr 280px;
      height: calc(100vh - 52px);
      margin-top: 52px;
      overflow: hidden;
    }

    .workspace {
      overflow-y: auto;
      background: var(--bg);
      padding: 24px;
      scrollbar-width: thin;
      scrollbar-color: var(--border) transparent;
    }

    @media (max-width: 900px) {
      .layout {
        grid-template-columns: 200px 1fr;
      }
      .right-panel {
        display: none;
      }
    }
  `,
})
export class ShellComponent implements OnInit {
  private readonly tenantService = inject(TenantService);

  ngOnInit(): void {
    this.tenantService.loadTenantDetails();
  }
}
