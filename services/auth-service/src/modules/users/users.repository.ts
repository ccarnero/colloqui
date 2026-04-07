/** Platform user persistence (`platform_users`). */
import { Inject, Injectable } from "@nestjs/common";
import { POSTGRES_SQL, type Sql } from "../../providers/postgres.provider";

export interface IUserRow {
  id: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Parameters for inserting a platform user row. */
export interface IInsertUserParams {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: string;
}

@Injectable()
export class UsersRepository {
  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {}

  findByEmail(email: string): ReturnType<Sql> {
    return this.sql`
      SELECT id FROM platform_users WHERE email = ${email} LIMIT 1
    `;
  }

  insertUser(params: IInsertUserParams): ReturnType<Sql> {
    const { id, email, passwordHash, role } = params;
    return this.sql`
      INSERT INTO platform_users (id, email, password_hash, role)
      VALUES (${id}, ${email}, ${passwordHash}, ${role})
      RETURNING id, email, role, created_at, updated_at
    `;
  }

  listActive(): ReturnType<Sql> {
    return this.sql`
      SELECT id, email, role, created_at, updated_at
      FROM platform_users
      WHERE is_active = true
      ORDER BY created_at DESC
    `;
  }

  findAdmin(): ReturnType<Sql> {
    return this.sql`
      SELECT id FROM platform_users WHERE role = 'admin' LIMIT 1
    `;
  }
}
