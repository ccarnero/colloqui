import { Controller, All, Req, Res } from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { ProxyService } from './proxy.service';

@Controller('proxy')
export class ProxyController {
  constructor(private readonly proxyService: ProxyService) {}

  @All('generic')
  handleGenericRoot(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.proxyService.handleGeneric(req, reply);
  }

  @All('generic/*')
  handleGenericPath(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.proxyService.handleGeneric(req, reply);
  }

  @All('ysocial')
  handleYSocialRoot(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.proxyService.handleYSocial(req, reply);
  }

  @All('ysocial/*')
  handleYSocialPath(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.proxyService.handleYSocial(req, reply);
  }

  @All('yflow')
  handleYFlowRoot(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.proxyService.handleYFlow(req, reply);
  }

  @All('yflow/*')
  handleYFlowPath(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.proxyService.handleYFlow(req, reply);
  }
}
