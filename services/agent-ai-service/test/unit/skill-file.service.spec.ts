import { beforeEach, describe, expect, it, mock } from "bun:test";
import { SkillFileService } from "../../src/modules/skills/skill-file.service";

// ── Helpers ───────────────────────────────────────────────────────────────

type LoggerSpy = Record<string, ReturnType<typeof mock>>;

/**
 * Replace the NestJS Logger on the instance so the "nothing silent" guards
 * can be asserted. The field is `readonly` for TypeScript only.
 */
function installLoggerSpy(service: SkillFileService): LoggerSpy {
  const spy: LoggerSpy = {
    log: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
  };
  (service as any).logger = spy;
  return spy;
}

/** Call the private frontmatter parser the same way `discoverSkills` does. */
function parse(
  service: SkillFileService,
  content: string,
  source = "SKILL.md"
): { name?: string; description?: string } | null {
  return (service as any).parseFrontmatter(content, source);
}

// ── Suite ─────────────────────────────────────────────────────────────────

describe("SkillFileService.parseFrontmatter", () => {
  let service: SkillFileService;
  let logger: LoggerSpy;

  beforeEach(() => {
    service = new SkillFileService();
    logger = installLoggerSpy(service);
  });

  it("parses a plain scalar name and description", () => {
    const result = parse(
      service,
      [
        "---",
        "name: code-review",
        "description: Review source code for bugs and style issues.",
        "---",
        "",
        "# Body",
      ].join("\n")
    );

    expect(result).toEqual({
      name: "code-review",
      description: "Review source code for bugs and style issues.",
    });
  });

  // ── Regression: block scalars ──────────────────────────────────────────

  it("folds a `>` block scalar instead of storing the literal '>' marker", () => {
    // 01-bugs-group-b E12 regression: the old line-by-line `indexOf(":")`
    // parser stored ">" as the description and dropped every indented
    // continuation line, so the model saw a description of ">".
    const result = parse(
      service,
      [
        "---",
        "name: pdf-processing",
        "description: >",
        "  Extract text and tables from PDF documents.",
        "  Use when the user uploads a PDF file.",
        "---",
        "",
        "# Body",
      ].join("\n")
    );

    expect(result?.name).toBe("pdf-processing");
    expect(result?.description).toBe(
      "Extract text and tables from PDF documents. Use when the user uploads a PDF file."
    );
    expect(result?.description).not.toBe(">");
    expect(result?.description).not.toContain(">");
  });

  it("keeps the line breaks of a `|` block scalar", () => {
    // 01-bugs-group-b E12 regression: same breakage as `>` — literal marker
    // stored, continuation lines dropped.
    const result = parse(
      service,
      [
        "---",
        "name: release-notes",
        "description: |",
        "  First line.",
        "  Second line.",
        "---",
      ].join("\n")
    );

    expect(result?.name).toBe("release-notes");
    expect(result?.description).toBe("First line.\nSecond line.");
    expect(result?.description).not.toBe("|");
  });

  // ── Regression: quoting and colons ─────────────────────────────────────

  it("unwraps a quoted value without leaving stray quote characters", () => {
    const result = parse(
      service,
      [
        "---",
        'name: "quoted-skill"',
        "description: 'Single quoted description.'",
        "---",
      ].join("\n")
    );

    expect(result).toEqual({
      name: "quoted-skill",
      description: "Single quoted description.",
    });
  });

  it("keeps an embedded quote inside an unquoted value", () => {
    // The old parser stripped any trailing quote character with
    // /^["']|["']$/g, mangling values that merely end with a quote.
    const result = parse(
      service,
      [
        "---",
        "name: quoting",
        'description: The user says "hello"',
        "---",
      ].join("\n")
    );

    expect(result?.description).toBe('The user says "hello"');
  });

  it("keeps every colon of a value that contains colons", () => {
    // 01-bugs-group-b E12 regression: splitting on the FIRST ":" mis-handles
    // values that themselves contain colons.
    const result = parse(
      service,
      [
        "---",
        "name: colon-values",
        'description: "Use when: the user asks about http://example.com:8080/docs"',
        "---",
      ].join("\n")
    );

    expect(result?.description).toBe(
      "Use when: the user asks about http://example.com:8080/docs"
    );
  });

  it("keeps colons that appear inside a block scalar", () => {
    const result = parse(
      service,
      [
        "---",
        "name: colon-block",
        "description: >",
        "  Use when: the user asks for a review.",
        "  Endpoint: http://example.com:8080/docs",
        "---",
      ].join("\n")
    );

    expect(result?.description).toBe(
      "Use when: the user asks for a review. Endpoint: http://example.com:8080/docs"
    );
  });

  // ── Guards: nothing silent ─────────────────────────────────────────────

  it("returns null and warns when the file has no frontmatter", () => {
    const result = parse(
      service,
      "# Just a markdown body\n\nNo frontmatter here.\n",
      "no-frontmatter/SKILL.md"
    );

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
    expect(String(logger.warn.mock.calls[0]?.[0])).toContain(
      "no-frontmatter/SKILL.md"
    );
  });

  it("returns null and warns when the frontmatter is not valid YAML", () => {
    const result = parse(
      service,
      ["---", "name: broken", "description: value: not: valid", "---"].join(
        "\n"
      ),
      "broken/SKILL.md"
    );

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
    expect(String(logger.warn.mock.calls[0]?.[0])).toContain("broken/SKILL.md");
  });

  it("returns null and warns when the frontmatter is not a YAML mapping", () => {
    const result = parse(
      service,
      ["---", "- name: listed", "- description: nope", "---"].join("\n"),
      "list/SKILL.md"
    );

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("ignores non-string name or description values", () => {
    const result = parse(
      service,
      ["---", "name: 42", "description: 7", "---"].join("\n"),
      "numeric/SKILL.md"
    );

    expect(result?.name).toBeUndefined();
    expect(result?.description).toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("ignores frontmatter keys other than name and description", () => {
    const result = parse(
      service,
      [
        "---",
        "name: extra-keys",
        "description: A skill.",
        "version: 2",
        "allowed-tools: [read, write]",
        "---",
      ].join("\n")
    );

    expect(result).toEqual({ name: "extra-keys", description: "A skill." });
  });
});

// ── Suite: discovery reads the parsed description ──────────────────────────

describe("SkillFileService.discoverSkills", () => {
  it("exposes the on-disk skill catalog with intact descriptions", () => {
    const service = new SkillFileService();
    installLoggerSpy(service);

    const skills = service.discoverSkills();

    // The repo ships services/agent-ai-service/skills/code-review/SKILL.md.
    const codeReview = skills.find((s) => s.name === "code-review");
    expect(codeReview).toBeDefined();
    expect(codeReview?.description.length).toBeGreaterThan(1);
    expect(codeReview?.description).not.toBe(">");
    expect(codeReview?.description).not.toBe("|");
  });

  it("caches the catalog after the first discovery", () => {
    const service = new SkillFileService();
    installLoggerSpy(service);

    const first = service.discoverSkills();
    const second = service.discoverSkills();

    expect(second).toBe(first);
  });
});
