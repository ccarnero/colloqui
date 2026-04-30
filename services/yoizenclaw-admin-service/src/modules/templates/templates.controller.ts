import { Controller, Get } from "@nestjs/common";
import { TemplatesService, type IAgentTemplate } from "./templates.service";

/** Read-only catalog of built-in agent templates for the admin UI. */
@Controller("admin/templates")
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  /**
   * @returns All YAML-backed templates bundled with the service.
   */
  @Get()
  async listTemplates(): Promise<{ templates: IAgentTemplate[] }> {
    const templates = await this.templatesService.loadTemplates();
    return { templates };
  }
}
