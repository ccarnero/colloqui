import { Controller, Get } from '@nestjs/common';
import { TemplatesService, AgentTemplate } from './templates.service';

@Controller('admin/templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  async listTemplates(): Promise<{ templates: AgentTemplate[] }> {
    const templates = await this.templatesService.loadTemplates();
    return { templates };
  }
}
