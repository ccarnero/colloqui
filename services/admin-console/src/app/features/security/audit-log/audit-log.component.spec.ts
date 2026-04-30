import { ComponentFixture, TestBed } from "@angular/core/testing";
import { AuditLogComponent } from "./audit-log.component";

describe("AuditLogComponent", () => {
  let fixture: ComponentFixture<AuditLogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuditLogComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AuditLogComponent);
    fixture.detectChanges();
  });

  it("renders Audit Log title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Audit Log");
  });
});
