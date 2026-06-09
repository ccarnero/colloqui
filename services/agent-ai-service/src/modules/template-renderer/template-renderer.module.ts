import { Module } from "@nestjs/common";
import { TemplateRendererService } from "./template-renderer.service";

@Module({
  providers: [TemplateRendererService],
  exports: [TemplateRendererService],
})
export class TemplateRendererModule {}
