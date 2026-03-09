import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { jwtVerify } from 'jose';
import type { JwtPayload } from '@yoizen/shared';

@Injectable()
export class JwtService implements OnModuleInit {
  private secret!: Uint8Array;

  onModuleInit(): void {
    const raw = process.env.JWT_SECRET;
    if (!raw) throw new Error('JWT_SECRET environment variable is required');
    this.secret = new TextEncoder().encode(raw);
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
}
