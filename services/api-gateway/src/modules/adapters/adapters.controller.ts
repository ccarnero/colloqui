import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { AdaptersProxyService } from "./adapters-proxy.service";
import { REQUEST_TENANT_KEY } from "../../guards/tenant.guard";

@Controller("adapters")
export class AdaptersController {
  constructor(private readonly proxy: AdaptersProxyService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Req() req: any, @Body() body: unknown) {
    return this.proxy.proxy(
      "POST",
      "/adapters",
      req[REQUEST_TENANT_KEY],
      undefined,
      body,
    );
  }

  @Get()
  async list(@Req() req: any, @Query("context") context?: string) {
    return this.proxy.proxy("GET", "/adapters", req[REQUEST_TENANT_KEY], {
      context,
    });
  }

  @Get(":id")
  async get(@Req() req: any, @Param("id") id: string) {
    return this.proxy.proxy(
      "GET",
      `/adapters/${encodeURIComponent(id)}`,
      req[REQUEST_TENANT_KEY],
    );
  }

  @Patch(":id")
  async update(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.proxy.proxy(
      "PATCH",
      `/adapters/${encodeURIComponent(id)}`,
      req[REQUEST_TENANT_KEY],
      undefined,
      body,
    );
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: any, @Param("id") id: string) {
    return this.proxy.proxy(
      "DELETE",
      `/adapters/${encodeURIComponent(id)}`,
      req[REQUEST_TENANT_KEY],
    );
  }

  @Post(":id/endpoints")
  @HttpCode(HttpStatus.CREATED)
  async addEndpoint(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.proxy.proxy(
      "POST",
      `/adapters/${encodeURIComponent(id)}/endpoints`,
      req[REQUEST_TENANT_KEY],
      undefined,
      body,
    );
  }

  @Delete(":id/endpoints/:epId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeEndpoint(
    @Req() req: any,
    @Param("id") id: string,
    @Param("epId") epId: string,
  ) {
    return this.proxy.proxy(
      "DELETE",
      `/adapters/${encodeURIComponent(id)}/endpoints/${encodeURIComponent(epId)}`,
      req[REQUEST_TENANT_KEY],
    );
  }
}
