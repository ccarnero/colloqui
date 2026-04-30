import { Injectable } from "@nestjs/common";
import * as fs from "fs/promises";
import * as yaml from "js-yaml";
import { PinoLoggerService } from "@yoizen/observability";
import { yoizenclawAdminServiceConfig } from "../../config";

export interface IAgentTemplateSubagent {
  name: string;
  description: string;
  system_prompt: string;
  enabled: boolean;
}

export interface IAgentTemplate {
  id: string;
  label: string;
  name: string;
  description: string;
  system_prompt: string;
  rules: string;
  soul: string;
  subagents: IAgentTemplateSubagent[];
}

interface ITemplatesFile {
  templates: Array<{
    id: string;
    label: string;
    name: string;
    description: string;
    system_prompt: string;
    rules: string;
    soul: string;
    subagents: Array<{
      name: string;
      description: string;
      system_prompt: string;
      enabled: boolean;
    }>;
  }>;
}

@Injectable()
export class TemplatesService {
  private readonly logger = new PinoLoggerService(TemplatesService.name);
  private templatesCache: IAgentTemplate[] | null = null;
  private readonly templatesPath: string;

  constructor() {
    this.templatesPath = yoizenclawAdminServiceConfig.templatesYamlPath;
  }

  async loadTemplates(): Promise<IAgentTemplate[]> {
    // Return cached templates if available
    if (this.templatesCache) {
      return this.templatesCache;
    }

    try {
      const fileContent = await fs.readFile(this.templatesPath, "utf-8");
      const parsed = yaml.load(fileContent) as ITemplatesFile;

      if (!parsed?.templates || !Array.isArray(parsed.templates)) {
        this.logger.warn("No templates found in templates.yaml");
        return [];
      }

      // Transform to expected format
      this.templatesCache = parsed.templates.map((template) => ({
        id: template.id,
        label: template.label,
        name: template.name,
        description: template.description,
        system_prompt: template.system_prompt,
        rules: template.rules,
        soul: template.soul,
        subagents:
          template.subagents?.map((sub) => ({
            name: sub.name,
            description: sub.description,
            system_prompt: sub.system_prompt,
            enabled: sub.enabled ?? true,
          })) || [],
      }));

      this.logger.log(`Loaded ${this.templatesCache.length} agent templates`);
      return this.templatesCache;
    } catch (error) {
      this.logger.error(
        `Failed to load templates from ${this.templatesPath}:`,
        error,
      );
      return [];
    }
  }
}
