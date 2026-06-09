import { Controller, Get } from "@nestjs/common";
import { ToolRegistryService } from "./tool-registry.service";
import type { ToolDef } from "./tool-definition";

@Controller("tools")
export class ToolsController {
  constructor(private readonly registry: ToolRegistryService) {}

  @Get("builtins")
  listBuiltinTools(): ToolDef[] {
    return this.registry.listBuiltinTools();
  }
}
