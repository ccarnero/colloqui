import { ComponentFixture, TestBed } from "@angular/core/testing";
import { DataRetentionComponent } from "./data-retention.component";

describe("DataRetentionComponent", () => {
  let fixture: ComponentFixture<DataRetentionComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DataRetentionComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DataRetentionComponent);
    fixture.detectChanges();
  });

  it("renders Data Retention title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Data Retention");
  });
});
