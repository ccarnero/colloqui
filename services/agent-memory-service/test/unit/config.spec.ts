import "../setup-env";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

describe("agentMemoryServiceConfig.ftsLanguage", () => {
  const originalEnv = process.env.MEMORY_FTS_LANGUAGE;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MEMORY_FTS_LANGUAGE;
    } else {
      process.env.MEMORY_FTS_LANGUAGE = originalEnv;
    }
    // Force module cache invalidation is not possible in Bun's module system,
    // so we test by accessing the getter with env manipulation before import.
    // Instead we exercise the getter logic inline by re-importing dynamically.
  });

  it("defaults to 'spanish' when MEMORY_FTS_LANGUAGE is not set", async () => {
    delete process.env.MEMORY_FTS_LANGUAGE;
    // Dynamic import to get fresh evaluation of the getter
    const { agentMemoryServiceConfig } = await import("../../src/config");
    expect(agentMemoryServiceConfig.ftsLanguage).toBe("spanish");
  });

  it("returns the configured language trimmed and lowercased", async () => {
    process.env.MEMORY_FTS_LANGUAGE = "  English  ";
    const { agentMemoryServiceConfig } = await import("../../src/config");
    expect(agentMemoryServiceConfig.ftsLanguage).toBe("english");
  });

  it("accepts underscore-containing language names like pg_catalog.english", async () => {
    process.env.MEMORY_FTS_LANGUAGE = "pg_catalog";
    const { agentMemoryServiceConfig } = await import("../../src/config");
    expect(agentMemoryServiceConfig.ftsLanguage).toBe("pg_catalog");
  });

  it("throws when the language contains invalid characters", async () => {
    process.env.MEMORY_FTS_LANGUAGE = "'; DROP TABLE memories; --";
    const { agentMemoryServiceConfig } = await import("../../src/config");
    expect(() => agentMemoryServiceConfig.ftsLanguage).toThrow(
      /Invalid MEMORY_FTS_LANGUAGE/,
    );
  });

  it("throws when the language contains spaces after trim", async () => {
    process.env.MEMORY_FTS_LANGUAGE = "en glish";
    const { agentMemoryServiceConfig } = await import("../../src/config");
    expect(() => agentMemoryServiceConfig.ftsLanguage).toThrow(
      /Invalid MEMORY_FTS_LANGUAGE/,
    );
  });

  it("throws when the language contains digits", async () => {
    process.env.MEMORY_FTS_LANGUAGE = "english2";
    const { agentMemoryServiceConfig } = await import("../../src/config");
    expect(() => agentMemoryServiceConfig.ftsLanguage).toThrow(
      /Invalid MEMORY_FTS_LANGUAGE/,
    );
  });
});
