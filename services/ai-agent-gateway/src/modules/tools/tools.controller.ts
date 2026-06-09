import { Controller, Get } from "@nestjs/common";
import { ToolsService } from "./tools.service";

/**
 * Exposes tool discovery endpoints proxied from agent-ai-service.
 */
@Controller("tools")
export class ToolsController {
  constructor(private readonly tools: ToolsService) {}

  @Get("builtins")
  listBuiltinTools(): Promise<object> {
    return this.tools.listBuiltinTools();
  }
}
