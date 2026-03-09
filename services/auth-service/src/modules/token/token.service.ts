import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { POSTGRES_SQL, type Sql } from '../../providers/postgres.provider';
import type {
  JwtPayload,
  TokenResponse,
  TokenScope,
  UserRole,
} from '@yoizen/shared';
import { ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL } from '@yoizen/shared';

const REFRESH_TOKEN_SCOPE = 'refresh';

@Injectable()
export class TokenService implements OnModuleInit {
  private readonly logger = new Logger(TokenService.name);
  private readonly environment: string;
  private secret!: Uint8Array;

  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {
    this.environment = process.env.PLATFORM_ENVIRONMENT ?? 'dev';
  }

  onModuleInit(): void {
    const raw = process.env.JWT_SECRET;
    if (!raw) throw new Error('JWT_SECRET environment variable is required');
    this.secret = new TextEncoder().encode(raw);
  }

  async clientCredentials(
    clientId: string,
    clientSecret: string,
  ): Promise<TokenResponse> {
    const rows = await this.sql`
      SELECT id, client_secret_hash, scope, is_active
      FROM api_clients
      WHERE client_id = ${clientId}
      LIMIT 1
    `;

    if (rows.length === 0) {
      throw new UnauthorizedException('Invalid client credentials');
    }

    const client = rows[0];
    if (!client.is_active) {
      throw new UnauthorizedException('Client is deactivated');
    }

    const valid = await Bun.password.verify(clientSecret, client.client_secret_hash);
    if (!valid) {
      throw new UnauthorizedException('Invalid client credentials');
    }

    const scope = client.scope as TokenScope;
    const accessToken = await this.signToken({
      sub: client.id,
      type: 'client',
      scope,
      env: this.environment,
    });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL,
      scope,
    };
  }

  async login(email: string, password: string): Promise<TokenResponse> {
    const rows = await this.sql`
      SELECT id, password_hash, role, is_active
      FROM platform_users
      WHERE email = ${email}
      LIMIT 1
    `;

    if (rows.length === 0) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const user = rows[0];
    if (!user.is_active) {
      throw new UnauthorizedException('Account is deactivated');
    }

    const valid = await Bun.password.verify(password, user.password_hash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const scope: TokenScope = 'platform';
    const role = user.role as UserRole;

    const accessToken = await this.signToken({
      sub: user.id,
      type: 'user',
      scope,
      role,
      env: this.environment,
    });

    const refreshToken = await this.signRefreshToken(user.id);

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL,
      scope,
      refresh_token: refreshToken,
    };
  }

  async refresh(refreshToken: string): Promise<TokenResponse> {
    let payload: { sub: string };
    try {
      const { payload: decoded } = await jwtVerify(refreshToken, this.secret, {
        algorithms: ['HS256'],
      });
      if (decoded.token_scope !== REFRESH_TOKEN_SCOPE) {
        throw new Error('Not a refresh token');
      }
      payload = { sub: decoded.sub as string };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const rows = await this.sql`
      SELECT id, role, is_active
      FROM platform_users
      WHERE id = ${payload.sub}
      LIMIT 1
    `;

    if (rows.length === 0 || !rows[0].is_active) {
      throw new UnauthorizedException('User not found or deactivated');
    }

    const user = rows[0];
    const scope: TokenScope = 'platform';
    const role = user.role as UserRole;

    const accessToken = await this.signToken({
      sub: user.id,
      type: 'user',
      scope,
      role,
      env: this.environment,
    });

    const newRefreshToken = await this.signRefreshToken(user.id);

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL,
      scope,
      refresh_token: newRefreshToken,
    };
  }

  async verify(token: string): Promise<JwtPayload> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        algorithms: ['HS256'],
      });
      return payload as unknown as JwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private async signToken(claims: {
    sub: string;
    type: 'user' | 'client';
    scope: TokenScope;
    role?: UserRole;
    env: string;
  }): Promise<string> {
    const builder = new SignJWT({
      type: claims.type,
      scope: claims.scope,
      ...(claims.role ? { role: claims.role } : {}),
      env: claims.env,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL}s`);

    return builder.sign(this.secret);
  }

  private async signRefreshToken(sub: string): Promise<string> {
    return new SignJWT({ token_scope: REFRESH_TOKEN_SCOPE })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime(`${REFRESH_TOKEN_TTL}s`)
      .sign(this.secret);
  }
}
