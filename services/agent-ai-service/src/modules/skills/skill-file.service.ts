import { Injectable, Logger } from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";

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
    if (this.cachedSkills) return this.cachedSkills;

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
        if (!entry.isDirectory()) continue;

        const skillDir = path.join(SKILLS_DIR, entry.name);
        const skillFile = path.join(skillDir, "SKILL.md");

        if (!fs.existsSync(skillFile)) continue;

        try {
          const content = fs.readFileSync(skillFile, "utf-8");
          const frontmatter = this.parseFrontmatter(content);

          if (!frontmatter?.name) continue;
          if (seenNames.has(frontmatter.name)) continue;
          seenNames.add(frontmatter.name);

          skills.push({
            name: frontmatter.name,
            description: frontmatter.description ?? "",
            path: skillDir,
          });
        } catch {
          // Skip invalid skills
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
      (s) => s.name.toLowerCase() === name.toLowerCase(),
    );
    if (!skill) return null;

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

  private parseFrontmatter(
    content: string,
  ): { name?: string; description?: string } | null {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match?.[1]) return null;

    const yaml = match[1];
    const result: Record<string, string> = {};

    for (const line of yaml.split("\n")) {
      const sep = line.indexOf(":");
      if (sep === -1) continue;
      const key = line.slice(0, sep).trim();
      const value = line.slice(sep + 1).trim().replace(/^["']|["']$/g, "");
      if (key && value) {
        result[key] = value;
      }
    }

    return result;
  }

  private stripFrontmatter(content: string): string {
    return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
  }
}
