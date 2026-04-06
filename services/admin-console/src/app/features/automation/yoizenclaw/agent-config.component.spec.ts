import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideMonacoEditor } from "ngx-monaco-editor-v2";
import { YoizenclawAgentConfigComponent } from "./agent-config.component";

describe("YoizenclawAgentConfigComponent", () => {
  let fixture: ComponentFixture<YoizenclawAgentConfigComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [YoizenclawAgentConfigComponent],
      providers: [provideMonacoEditor({ defaultOptions: {} })],
    }).compileComponents();

    fixture = TestBed.createComponent(YoizenclawAgentConfigComponent);
    fixture.componentRef.setInput("section", "general");
    fixture.componentRef.setInput("credentialProfiles", []);
    fixture.componentRef.setInput("editorOptions", {});
    fixture.detectChanges();
  });

  it("creates", () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
