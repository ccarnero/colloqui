import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideMonacoEditor } from "ngx-monaco-editor-v2";
import { AiChatPanelComponent } from "./chat-panel.component";

describe("AiChatPanelComponent", () => {
  let fixture: ComponentFixture<AiChatPanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AiChatPanelComponent],
      providers: [provideMonacoEditor({ defaultOptions: {} })],
    }).compileComponents();

    fixture = TestBed.createComponent(AiChatPanelComponent);
    fixture.componentRef.setInput("editorOptions", {});
    fixture.componentRef.setInput("availableSkills", []);
    fixture.componentRef.setInput("availableTools", []);
    fixture.componentRef.setInput("extractedMentions", []);
    fixture.detectChanges();
  });

  it("creates", () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
