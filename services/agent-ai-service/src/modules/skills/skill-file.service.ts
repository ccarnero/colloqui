import * as fs from "node:fs";
import * as path from "node:path";
import { Injectable, Logger } from "@nestjs/common";

export interface SkillMetadata {
  name: string;
  description: string;
  path: string;
}

export interface LoadedSkill {
  name: string;
  description: string;
  content: string;
  path: string;
}

const SKILLS_DIR = path.resolve(__dirname, "../../../skills");

@Injectable()
export class SkillFileService {
  private readonly logger = new Logger(SkillFileService.name);
  private cachedSkills: SkillMetadata[] | null = null;

  discoverSkills(): SkillMetadata[] {
    if (this.cachedSkills) {
      return this.cachedSkills;
    }

    const skills: SkillMetadata[] = [];
    const seenNames = new Set<string>();

    try {
      if (!fs.existsSync(SKILLS_DIR)) {
        this.logger.warn(`Skills directory not found: ${SKILLS_DIR}`);
        this.cachedSkills = [];
        return [];
      }

      const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const skillDir = path.join(SKILLS_DIR, entry.name);
        const skillFile = path.join(skillDir, "SKILL.md");

        if (!fs.existsSync(skillFile)) {
          continue;
        }

        try {
          const content = fs.readFileSync(skillFile, "utf-8");
          const frontmatter = this.parseFrontmatter(content, skillFile);

          if (!frontmatter?.name) {
            this.logger.warn(
              `Skipping skill ${skillFile}: frontmatter has no usable 'name'`
            );
            continue;
          }
          if (seenNames.has(frontmatter.name)) {
            this.logger.warn(
              `Skipping skill ${skillFile}: duplicate skill name '${frontmatter.name}'`
            );
            continue;
          }
          seenNames.add(frontmatter.name);

          skills.push({
            name: frontmatter.name,
            description: frontmatter.description ?? "",
            path: skillDir,
          });
        } catch (err) {
          this.logger.warn(`Skipping unreadable skill ${skillFile}: ${err}`);
        }
      }
    } catch (err) {
      this.logger.error(`Failed to discover skills: ${err}`);
    }

    this.cachedSkills = skills;
    this.logger.log(`Discovered ${skills.length} skills from ${SKILLS_DIR}`);
    return skills;
  }

  loadSkill(name: string): LoadedSkill | null {
    const skills = this.discoverSkills();
    const skill = skills.find(
      (s) => s.name.toLowerCase() === name.toLowerCase()
    );
    if (!skill) {
      return null;
    }

    try {
      const skillFile = path.join(skill.path, "SKILL.md");
      const content = fs.readFileSync(skillFile, "utf-8");
      const body = this.stripFrontmatter(content);

      return {
        name: skill.name,
        description: skill.description,
        content: body,
        path: skill.path,
      };
    } catch {
      return null;
    }
  }

  /**
   * Parse the YAML frontmatter block of a SKILL.md file.
   *
   * Uses `Bun.YAML.parse` — the service is compiled with tsc but always
   * executed by Bun (`bun dist/main.js` in the Dockerfile, `bun test` in
   * CI), the same way `auth-service` relies on `Bun.password`. A real YAML
   * parser is required because skills use block scalars (`>` and `|` with
   * indented continuation lines), quoted values, and values containing
   * colons — none of which survive a line-by-line split on the first ":".
   *
   * Returns `null` when the frontmatter is missing, malformed, or not a
   * mapping. Every rejection is logged; the caller skips the skill.
   */
  private parseFrontmatter(
    content: string,
    source: string
  ): { name?: string; description?: string } | null {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match?.[1]) {
      this.logger.warn(`No YAML frontmatter block found in ${source}`);
      return null;
    }

    let parsed: unknown;
    try {
      parsed = Bun.YAML.parse(match[1]);
    } catch (err) {
      this.logger.warn(
        `Unparseable YAML frontmatter in ${source}, skipping skill: ${err}`
      );
      return null;
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      this.logger.warn(
        `YAML frontmatter in ${source} is not a mapping (got ${
          Array.isArray(parsed) ? "array" : typeof parsed
        }), skipping skill`
      );
      return null;
    }

    const record = parsed as Record<string, unknown>;

    return {
      name: this.readStringField(record, "name", source),
      description: this.readStringField(record, "description", source),
    };
  }

  /**
   * Read a frontmatter field, accepting strings only. A present-but-wrong
   * type (number, list, mapping) is logged and dropped rather than coerced.
   */
  private readStringField(
    record: Record<string, unknown>,
    key: string,
    source: string
  ): string | undefined {
    const value = record[key];
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value !== "string") {
      this.logger.warn(
        `Frontmatter field '${key}' in ${source} is ${typeof value}, expected a string — ignoring it`
      );
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private stripFrontmatter(content: string): string {
    return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
  }
}
