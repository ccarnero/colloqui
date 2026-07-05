import { Controller, All, Req, Res } from "@nestjs/common";
import type { FastifyRequest, FastifyReply } from "fastify";
import { ProxyProxyService } from "./proxy-proxy.service";
import { ApiTags } from "@nestjs/swagger";

@ApiTags("proxy")
@Controller("proxy")
export class ProxyController {
  constructor(private readonly proxyService: ProxyProxyService) {}

  @All()
  handleRoot(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.proxyService.forward(req, reply);
  }

  @All("*")
  handleAll(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.proxyService.forward(req, reply);
  }
}
