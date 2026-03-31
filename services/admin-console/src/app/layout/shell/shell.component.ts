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
    <div class="yoizen-layout text-primary flex h-screen">
      <app-sidebar class="w-64 bg-sidebar border-r border-subtle flex-shrink-0" />
      
      <div class="flex-1 flex flex-col min-w-0">
        <app-header class="bg-surface border-b border-subtle" />
        
        <div class="flex flex-1 overflow-hidden">
          <main class="workspace flex-1 overflow-auto bg-background p-6">
            <router-outlet />
          </main>
          
          <app-right-panel class="right-panel w-72 bg-surface border-l border-subtle overflow-y-auto" />
        </div>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      height: 100vh;
      overflow: hidden;
      background: var(--bg-background);
      color: var(--text-primary);
    }

    .yoizen-layout {
      display: flex;
      height: 100vh;
    }

    .w-64 { width: 256px; }
    .w-72 { width: 288px; }
    .flex { display: flex; }
    .flex-col { flex-direction: column; }
    .flex-1 { flex: 1 1 0%; }
    .flex-shrink-0 { flex-shrink: 0; }
    .min-w-0 { min-width: 0; }
    .h-screen { height: 100vh; }
    .overflow-hidden { overflow: hidden; }
    .overflow-auto { overflow: auto; }
    .overflow-y-auto { overflow-y: auto; }
    .p-6 { padding: 24px; }

    .bg-sidebar { background-color: var(--bg-sidebar); }
    .bg-background { background-color: var(--bg-background); }
    .bg-surface { background-color: var(--bg-surface); }
    .text-primary { color: var(--text-primary); }

    .border-r { border-right: 1px solid var(--border-subtle); }
    .border-b { border-bottom: 1px solid var(--border-subtle); }
    .border-l { border-left: 1px solid var(--border-subtle); }

    .workspace {
      scrollbar-width: thin;
      scrollbar-color: var(--border-subtle) transparent;
    }

    @media (max-width: 900px) {
      .yoizen-layout {
        flex-direction: column;
      }
      .w-64 { width: 100%; height: auto; border-right: none; border-bottom: 1px solid var(--border-subtle); }
      .right-panel { display: none; }
    }
  `,
})
export class ShellComponent implements OnInit {
  private readonly tenantService = inject(TenantService);

  ngOnInit(): void {
    this.tenantService.loadTenantDetails();
  }
}
