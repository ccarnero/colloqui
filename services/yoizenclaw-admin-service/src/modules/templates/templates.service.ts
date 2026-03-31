import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface AgentTemplateSubagent {
  name: string;
  description: string;
  system_prompt: string;
  enabled: boolean;
}

export interface AgentTemplate {
  id: string;
  label: string;
  name: string;
  description: string;
  system_prompt: string;
  rules: string;
  soul: string;
  subagents: AgentTemplateSubagent[];
}

interface TemplatesFile {
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
  private readonly logger = new Logger(TemplatesService.name);
  private templatesCache: AgentTemplate[] | null = null;
  private readonly templatesPath: string;

  constructor() {
    // Resolve path relative to project root
    this.templatesPath = path.resolve(process.cwd(), 'data', 'templates.yaml');
  }

  async loadTemplates(): Promise<AgentTemplate[]> {
    // Return cached templates if available
    if (this.templatesCache) {
      return this.templatesCache;
    }

    try {
      const fileContent = await fs.readFile(this.templatesPath, 'utf-8');
      const parsed = yaml.load(fileContent) as TemplatesFile;
      
      if (!parsed?.templates || !Array.isArray(parsed.templates)) {
        this.logger.warn('No templates found in templates.yaml');
        return [];
      }

      // Transform to expected format
      this.templatesCache = parsed.templates.map(template => ({
        id: template.id,
        label: template.label,
        name: template.name,
        description: template.description,
        system_prompt: template.system_prompt,
        rules: template.rules,
        soul: template.soul,
        subagents: template.subagents?.map(sub => ({
          name: sub.name,
          description: sub.description,
          system_prompt: sub.system_prompt,
          enabled: sub.enabled ?? true,
        })) || [],
      }));

      this.logger.log(`Loaded ${this.templatesCache.length} agent templates`);
      return this.templatesCache;
    } catch (error) {
      this.logger.error(`Failed to load templates from ${this.templatesPath}:`, error);
      return [];
    }
  }

  async getTemplateById(id: string): Promise<AgentTemplate | null> {
    const templates = await this.loadTemplates();
    return templates.find(t => t.id === id) || null;
  }

  // Call this to reload templates (e.g., after file changes)
  invalidateCache(): void {
    this.templatesCache = null;
    this.logger.log('Templates cache invalidated');
  }
}
