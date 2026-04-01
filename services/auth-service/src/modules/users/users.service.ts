import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { POSTGRES_SQL, type Sql } from '../../providers/postgres.provider';
import { ARGON2_OPTIONS } from '../../utils/password';

export interface UserRow {
  id: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {}

  async onModuleInit(): Promise<void> {
    await this.seedAdmin();
  }

  async create(
    email: string,
    password: string,
    role: string,
  ): Promise<Omit<UserRow, 'is_active'>> {
    const existing = await this.sql`
      SELECT id FROM platform_users WHERE email = ${email} LIMIT 1
    `;
    if (existing.length > 0) {
      throw new ConflictException(`User with email '${email}' already exists`);
    }

    const id = crypto.randomUUID();
    const passwordHash = await Bun.password.hash(password, ARGON2_OPTIONS);

    const rows = await this.sql`
      INSERT INTO platform_users (id, email, password_hash, role)
      VALUES (${id}, ${email}, ${passwordHash}, ${role})
      RETURNING id, email, role, created_at, updated_at
    `;

    this.logger.log(`Created user ${email} with role ${role}`);
    return rows[0] as Omit<UserRow, 'is_active'>;
  }

  async list(): Promise<Omit<UserRow, 'is_active'>[]> {
    const rows = await this.sql`
      SELECT id, email, role, created_at, updated_at
      FROM platform_users
      WHERE is_active = true
      ORDER BY created_at DESC
    `;
    return rows as unknown as Omit<UserRow, 'is_active'>[];
  }

  private async seedAdmin(): Promise<void> {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) return;

    const existing = await this.sql`
      SELECT id FROM platform_users WHERE role = 'admin' LIMIT 1
    `;
    if (existing.length > 0) return;

    await this.create(email, password, 'admin');
    this.logger.log(`Seeded admin user: ${email}`);
  }
}
