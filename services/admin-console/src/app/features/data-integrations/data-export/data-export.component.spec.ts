import { ComponentFixture, TestBed } from "@angular/core/testing";
import { vi } from "vitest";
import { NotificationService } from "../../../core/services/notification.service";
import { DataExportComponent } from "./data-export.component";

describe("DataExportComponent", () => {
  let fixture: ComponentFixture<DataExportComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DataExportComponent],
      providers: [
        {
          provide: NotificationService,
          useValue: { push: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DataExportComponent);
    fixture.detectChanges();
  });

  it("renders Data Export title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Data Export");
  });
});
