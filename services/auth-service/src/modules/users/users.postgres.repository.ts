/** Platform user persistence (`platform_users`) — PostgreSQL. */
import { Inject, Injectable } from "@nestjs/common";
import { POSTGRES_SQL, type Sql } from "@yoizen/database";
import type {
  IInsertUserParams,
  IUsersRepository,
  IUserRow,
} from "./users.repository.interface";

@Injectable()
export class UsersPostgresRepository implements IUsersRepository {
  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {}

  async findByEmail(email: string): Promise<Array<{ id: string }>> {
    const rows = await this.sql<Array<{ id: string }>>`
      SELECT id FROM platform_users WHERE email = ${email} LIMIT 1
    `;
    return rows;
  }

  async insertUser(
    params: IInsertUserParams,
  ): Promise<Omit<IUserRow, "is_active">[]> {
    const { id, email, passwordHash, role } = params;
    const rows = await this.sql<
      Array<Omit<IUserRow, "is_active">>
    >`
      INSERT INTO platform_users (id, email, password_hash, role)
      VALUES (${id}, ${email}, ${passwordHash}, ${role})
      RETURNING id, email, role, created_at, updated_at
    `;
    return rows;
  }

  async listActive(): Promise<Omit<IUserRow, "is_active">[]> {
    const rows = await this.sql<Array<Omit<IUserRow, "is_active">>>`
      SELECT id, email, role, created_at, updated_at
      FROM platform_users
      WHERE is_active = true
      ORDER BY created_at DESC
    `;
    return rows;
  }

  async findAdmin(): Promise<Array<{ id: string }>> {
    const rows = await this.sql<Array<{ id: string }>>`
      SELECT id FROM platform_users WHERE role = 'admin' LIMIT 1
    `;
    return rows;
  }
}
