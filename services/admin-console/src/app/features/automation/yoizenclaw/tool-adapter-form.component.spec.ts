import { ComponentFixture, TestBed } from "@angular/core/testing";
import { vi } from "vitest";
import { of } from "rxjs";
import { ToolAdapterFormComponent } from "./tool-adapter-form.component";
import { AdaptersService } from "../../../core/services/adapters.service";

describe("ToolAdapterFormComponent", () => {
  let fixture: ComponentFixture<ToolAdapterFormComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToolAdapterFormComponent],
      providers: [
        {
          provide: AdaptersService,
          useValue: {
            listAdapters: vi.fn().mockReturnValue(of({ adapters: [] })),
            getAdapter: vi.fn().mockReturnValue(
              of({ id: "a1", endpoints: [] }),
            ),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ToolAdapterFormComponent);
    fixture.detectChanges();
  });

  it("creates", () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
