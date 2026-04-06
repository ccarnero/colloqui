import { Body, Controller, Post } from "@nestjs/common";
import { TokenService } from "./token.service";
import { ClientCredentialsDto, LoginDto, RefreshDto } from "./token.dto";
import type { TokenResponse } from "@yoizen/shared";

@Controller("auth")
export class TokenController {
  constructor(private readonly tokenService: TokenService) {}

  @Post("token")
  async token(@Body() dto: ClientCredentialsDto): Promise<TokenResponse> {
    return this.tokenService.clientCredentials(dto.client_id, dto.client_secret);
  }

  @Post("login")
  async login(@Body() dto: LoginDto): Promise<TokenResponse> {
    return this.tokenService.login(dto.email, dto.password, dto.tenant_id);
  }

  @Post("refresh")
  async refresh(@Body() dto: RefreshDto): Promise<TokenResponse> {
    return this.tokenService.refresh(dto.refresh_token);
  }
}
