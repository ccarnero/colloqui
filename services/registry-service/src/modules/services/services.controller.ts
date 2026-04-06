import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Headers,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ServicesService } from "./services.service";
import { RegisterServiceDto, UpdateServiceDto } from "./services.dto";
import { TENANT_HEADER } from "@yoizen/shared";

@Controller("services")
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Headers(TENANT_HEADER) tenantId: string,
    @Body() dto: RegisterServiceDto,
  ) {
    return this.servicesService.register(tenantId, dto);
  }

  @Get()
  async list(@Headers(TENANT_HEADER) tenantId: string) {
    return this.servicesService.list(tenantId);
  }

  @Get(":id")
  async get(@Headers(TENANT_HEADER) tenantId: string, @Param("id") id: string) {
    return this.servicesService.get(tenantId, id);
  }

  @Patch(":id")
  async update(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("id") id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.servicesService.update(tenantId, id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("id") id: string,
  ) {
    return this.servicesService.remove(tenantId, id);
  }

  @Get(":id/revisions")
  async listRevisions(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("id") id: string,
  ) {
    return this.servicesService.listRevisions(tenantId, id);
  }
}
