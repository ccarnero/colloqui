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
import {
  CreateAutoReplyRuleDto,
  ListAutoReplyRulesQueryDto,
} from "./auto-reply.dto";

@Controller("channels/auto-reply")
export class AutoReplyController {
  constructor(private readonly autoReply: AutoReplyService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createRule(
    @Headers(TENANT_HEADER) tenantId: string,
    @Body() dto: CreateAutoReplyRuleDto,
  ) {
    return this.autoReply.createRule({
      tenantId,
      accountId: dto.accountId,
      channel: dto.channel as Channel,
      triggerPattern: dto.triggerPattern,
      replyText: dto.replyText,
    });
  }

  @Get()
  async listRules(
    @Headers(TENANT_HEADER) tenantId: string,
    @Query() query: ListAutoReplyRulesQueryDto,
  ) {
    return this.autoReply.listRules(tenantId, query.accountId);
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
