import { ComponentFixture, TestBed } from "@angular/core/testing";
import { SchemaManagerComponent } from "./schema-manager.component";

describe("SchemaManagerComponent", () => {
  let fixture: ComponentFixture<SchemaManagerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SchemaManagerComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SchemaManagerComponent);
    fixture.detectChanges();
  });

  it("renders Schema Manager title", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Schema Manager");
  });
});
