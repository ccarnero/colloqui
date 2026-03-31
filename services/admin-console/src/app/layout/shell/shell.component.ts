import { Component, inject, type OnInit, signal } from "@angular/core";
import { RouterOutlet } from "@angular/router";
import { HeaderComponent } from "../header/header.component";
import { SidebarComponent } from "../sidebar/sidebar.component";
import { RightPanelComponent } from "../right-panel/right-panel.component";
import { TenantService } from "../../core/services/tenant.service";

@Component({
  selector: "app-shell",
  imports: [RouterOutlet, HeaderComponent, SidebarComponent, RightPanelComponent],
  template: `
    <div class="yoizen-layout text-primary flex h-screen" [class.mobile-open]="sidebarOpen()">
      @if (sidebarOpen()) {
        <div class="sidebar-overlay" (click)="sidebarOpen.set(false)"></div>
      }
      <app-sidebar class="w-64 theme-sidebar bg-sidebar border-r border-subtle flex-shrink-0" />
      
      <div class="flex-1 flex flex-col min-w-0">
        <app-header (toggleSidebar)="sidebarOpen.set(!sidebarOpen())" (toggleRightPanel)="rightPanelOpen.set(!rightPanelOpen())" class="bg-surface border-b border-subtle" />
        
        <div class="flex flex-1 overflow-hidden">
          <main class="workspace flex-1 overflow-auto bg-background p-6">
            <router-outlet />
          </main>
          
          @if (rightPanelOpen()) {
            <app-right-panel class="right-panel w-72 bg-surface border-l border-subtle overflow-y-auto" />
          }
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
        position: relative;
      }
      .theme-sidebar {
        position: fixed;
        top: 0;
        left: -280px;
        bottom: 0;
        width: 256px;
        z-index: 50;
        transition: transform 0.3s ease;
      }
      .yoizen-layout.mobile-open .theme-sidebar {
        transform: translateX(280px); /* 256px + some shadow offset possibly, wait, left is -280px, wait, just left:0 and translateX(-100%) */
      }
      .right-panel { display: none; }
      
      .sidebar-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.5);
        z-index: 40;
      }
    }
  `,
})
export class ShellComponent implements OnInit {
  private readonly tenantService = inject(TenantService);
  
  readonly sidebarOpen = signal(false);
  readonly rightPanelOpen = signal(true);

  ngOnInit(): void {
    this.tenantService.loadTenantDetails();
  }
}
