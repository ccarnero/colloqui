import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideMonacoEditor } from "ngx-monaco-editor-v2";
import { YoizenclawChatPanelComponent } from "./chat-panel.component";

describe("YoizenclawChatPanelComponent", () => {
  let fixture: ComponentFixture<YoizenclawChatPanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [YoizenclawChatPanelComponent],
      providers: [provideMonacoEditor({ defaultOptions: {} })],
    }).compileComponents();

    fixture = TestBed.createComponent(YoizenclawChatPanelComponent);
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
