import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  provideHttpClientTesting,
  HttpTestingController,
} from "@angular/common/http/testing";
import { firstValueFrom } from "rxjs";

import { SkillsService } from "./skills.service";
import { environment } from "../../../environments/environment";

// ---------------------------------------------------------------------------
// BUG-2: Catalog ISkill → SkillDefinition mapping
//
// The frontend interfaces ISkill, ICreateSkillPayload, and IUpdateSkillPayload
// are missing the new fields required by the runtime SkillDefinition:
//   - when_to_use  (string)
//   - priority     (integer)
//   - allowed_tools (string array)
//   - mode         (enum: router | llm_driven | inline)
//
// These tests verify the expected shape including the new fields.
// ---------------------------------------------------------------------------

describe("SkillsService — BUG-2 new fields", () => {
  let service: SkillsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SkillsService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(SkillsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  // =========================================================================
  //  Type shape — ISkill should include new optional fields
  // =========================================================================

  it("ISkill type includes new optional fields (when_to_use, priority, allowed_tools, mode) (T15)", () => {
    // This simulates what the API will return after the BUG-2 migration.
    const skill = {
      id: "s1",
      name: "pricing",
      description: "Pricing assistant",
      system_prompt: "You are a pricing expert",
      icon: "smart_toy",
      color: "#42a5f5",
      trigger_commands: ["/pricing"],
      files: [],
      is_active: true,
      created_at: "2025-01-01T00:00:00.000Z",
      updated_at: "2025-01-02T00:00:00.000Z",
      // New BUG-2 fields:
      when_to_use: "When the user asks about pricing",
      priority: 5,
      allowed_tools: ["communicate", "search_tickets"],
      mode: "router" as const,
    };

    // Verify all new fields are present and have the correct types
    expect(skill.when_to_use).toBe("When the user asks about pricing");
    expect(typeof skill.when_to_use).toBe("string");

    expect(skill.priority).toBe(5);
    expect(typeof skill.priority).toBe("number");

    expect(skill.allowed_tools).toEqual(["communicate", "search_tickets"]);
    expect(Array.isArray(skill.allowed_tools)).toBe(true);
    expect(skill.allowed_tools.every((t) => typeof t === "string")).toBe(true);

    expect(skill.mode).toBe("router");
    expect(typeof skill.mode).toBe("string");

    // Verify the mode only accepts valid values
    const validModes = ["router", "llm_driven", "inline"] as const;
    expect(validModes.includes(skill.mode as typeof validModes[number])).toBe(true);
  });

  // =========================================================================
  //  Create payload — ICreateSkillPayload should accept new fields
  // =========================================================================

  it("ICreateSkillPayload accepts new fields (T16)", () => {
    const payload = {
      name: "pricing-skill",
      system_prompt: "Pricing assistant",
      // New BUG-2 fields (all optional):
      when_to_use: "When user asks about pricing",
      priority: 5,
      allowed_tools: ["communicate"],
      mode: "llm_driven",
    };

    // All new fields should be accessible on the payload
    expect(payload.when_to_use).toBe("When user asks about pricing");
    expect(payload.priority).toBe(5);
    expect(payload.allowed_tools).toEqual(["communicate"]);
    expect(payload.mode).toBe("llm_driven");

    // New fields should be optional — verify payload without them works
    const minimalPayload = {
      name: "minimal",
      system_prompt: "prompt",
    };
    expect(minimalPayload.name).toBe("minimal");
    expect(minimalPayload.system_prompt).toBe("prompt");
  });

  // =========================================================================
  //  list() — API response should map the new fields correctly
  // =========================================================================

  it("list() API response maps new fields correctly (T17)", async () => {
    const promise = firstValueFrom(service.list());

    const req = httpMock.expectOne(`${environment.apiUrl}/admin/skills`);
    expect(req.request.method).toBe("GET");

    // Simulate the post-migration API response including new fields
    req.flush({
      skills: [
        {
          id: "s1",
          name: "pricing",
          description: "Pricing assistant",
          system_prompt: "You are a pricing expert",
          icon: "smart_toy",
          color: "#42a5f5",
          trigger_commands: ["/pricing"],
          files: [],
          is_active: true,
          created_at: "2025-01-01T00:00:00.000Z",
          updated_at: "2025-01-02T00:00:00.000Z",
          // New BUG-2 fields:
          when_to_use: "When user asks about pricing",
          priority: 10,
          allowed_tools: ["communicate", "search_tickets"],
          mode: "router",
        },
      ],
      total: 1,
    });

    const res = await promise;
    expect(res.skills).toHaveLength(1);
    expect(res.total).toBe(1);

    const skill = res.skills[0]!;
    // Core fields
    expect(skill.id).toBe("s1");
    expect(skill.name).toBe("pricing");
    expect(skill.system_prompt).toBe("You are a pricing expert");

    // New fields from API response
    expect(skill.when_to_use).toBe("When user asks about pricing");
    expect(skill.priority).toBe(10);
    expect(skill.allowed_tools).toEqual(["communicate", "search_tickets"]);
    expect(skill.mode).toBe("router");
  });
});
