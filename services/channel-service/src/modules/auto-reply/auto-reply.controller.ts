import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from "@nestjs/common";
import type { Channel } from "@yoizen/shared";
import { TENANT_HEADER } from "@yoizen/shared";
import { AutoReplyService } from "./auto-reply.service";
import { CreateAutoReplyRuleDto } from "./auto-reply.dto";

@Controller("channels/auto-reply")
export class AutoReplyController {
  constructor(private readonly autoReply: AutoReplyService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createRule(
    @Headers(TENANT_HEADER) tenantId: string,
    @Body() dto: CreateAutoReplyRuleDto,
  ) {
    return this.autoReply.createRule(
      tenantId,
      dto.accountId,
      dto.channel as Channel,
      dto.triggerPattern,
      dto.replyText,
    );
  }

  @Get()
  async listRules(
    @Headers(TENANT_HEADER) tenantId: string,
    @Query("accountId") accountId?: string,
  ) {
    return this.autoReply.listRules(tenantId, accountId);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRule(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("id") id: string,
  ) {
    const deleted = await this.autoReply.deleteRule(tenantId, id);
    if (!deleted) throw new NotFoundException("Rule not found");
  }
}
