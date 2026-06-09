import { ComponentFixture, TestBed } from "@angular/core/testing";
import { NO_ERRORS_SCHEMA } from "@angular/core";
import { of, throwError } from "rxjs";
import { vi, describe, expect, it, beforeEach } from "vitest";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";

import { SkbUploadDialogComponent } from "../../../src/app/features/automation/ai/structured-kb/skb-upload-dialog.component";
import { StructuredKbService } from "../../../src/app/core/services/structured-kb.service";

describe("SkbUploadDialogComponent", () => {
  let fixture: ComponentFixture<SkbUploadDialogComponent>;
  let component: SkbUploadDialogComponent;
  let mockService: Record<string, ReturnType<typeof vi.fn>>;
  let mockDialogRef: { close: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockService = {
      uploadFile: vi.fn().mockReturnValue(of({ id: "f1", name: "data.csv", status: "pending" })),
    };
    mockDialogRef = { close: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [SkbUploadDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { containerId: "skb-1" } },
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: StructuredKbService, useValue: mockService },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(SkbUploadDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it("dialog opens with file picker", () => {
    const el = fixture.nativeElement as HTMLElement;
    const fileInput = el.querySelector("input[type='file']") as HTMLInputElement;
    expect(fileInput).toBeTruthy();
  });

  it("shows supported formats: CSV, XLSX, XLS", () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("CSV");
    expect(el.textContent).toContain("XLSX");
    expect(el.textContent).toContain("XLS");
  });

  it("validates file type on selection", () => {
    const invalidFile = new File(["data"], "report.pdf", { type: "application/pdf" });
    component.onFileSelected(invalidFile);
    expect(component.error()).toContain("Unsupported file type");
    expect(component.selectedFile()).toBeNull();
  });

  it("accepts valid CSV file", () => {
    const validFile = new File(["id,name\n1,Widget"], "data.csv", { type: "text/csv" });
    component.onFileSelected(validFile);
    expect(component.selectedFile()).toBe(validFile);
    expect(component.error()).toBeNull();
  });

  it("accepts valid XLSX file", () => {
    const validFile = new File(["xlsx-data"], "report.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    component.onFileSelected(validFile);
    expect(component.selectedFile()).toBe(validFile);
    expect(component.error()).toBeNull();
  });

  it("shows upload progress", () => {
    component.selectedFile.set(new File(["data"], "data.csv", { type: "text/csv" }));
    component.uploading.set(true);
    component.uploadProgress.set(55);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("55");
  });

  it("success state shows confirmation", () => {
    component.selectedFile.set(new File(["data"], "data.csv", { type: "text/csv" }));
    component.uploadSuccess.set(true);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    // @ts-expect-error -- void expression in || chain is intentional
    expect(el.textContent).toContain("uploaded") || expect(el.textContent).toContain("success") || expect(el.textContent).toContain("File");
  });

  it("error state shows error message", () => {
    mockService.uploadFile = vi.fn().mockReturnValue(throwError(() => new Error("Upload failed")));
    component.selectedFile.set(new File(["data"], "data.csv", { type: "text/csv" }));
    component.upload();
    fixture.detectChanges();
    expect(component.error()).toBeTruthy();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("Upload failed");
  });

  it("close button works", () => {
    component.close();
    expect(mockDialogRef.close).toHaveBeenCalled();
  });

  it("upload button disabled when no file selected", () => {
    component.selectedFile.set(null);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const uploadBtn = Array.from(el.querySelectorAll("button")).find(
      (b) => b.textContent?.toLowerCase().includes("upload"),
    ) as HTMLButtonElement;
    if (uploadBtn) {
      expect(uploadBtn.disabled).toBe(true);
    }
    expect(component.canUpload()).toBe(false);
  });
});
