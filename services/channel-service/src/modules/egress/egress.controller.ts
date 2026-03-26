import {
  Controller,
  Post,
  Body,
  Param,
  Headers,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { TENANT_HEADER } from "@yoizen/shared";
import type { SendMessageResult } from "@yoizen/shared";
import { EgressService } from "./egress.service";
import { SendMessageDto } from "./egress.dto";

@Controller("channels")
export class EgressController {
  constructor(private readonly egress: EgressService) {}

  @Post(":accountId/messages")
  @HttpCode(HttpStatus.OK)
  async sendMessage(
    @Param("accountId") accountId: string,
    @Headers(TENANT_HEADER) tenantId: string,
    @Body() dto: SendMessageDto,
  ): Promise<SendMessageResult> {
    return this.egress.send(tenantId, accountId, {
      to: dto.to,
      type: dto.type,
      text: dto.text,
      templateName: dto.templateName,
      templateLanguage: dto.templateLanguage,
      templateComponents: dto.templateComponents,
      mediaUrl: dto.mediaUrl,
      caption: dto.caption,
    });
  }
}
