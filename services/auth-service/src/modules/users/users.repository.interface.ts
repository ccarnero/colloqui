export const USERS_REPOSITORY = Symbol("USERS_REPOSITORY");

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

export interface IUsersRepository {
  findByEmail(email: string): Promise<Array<{ id: string }>>;
  insertUser(
    params: IInsertUserParams,
  ): Promise<Omit<IUserRow, "is_active">[]>;
  listActive(): Promise<Omit<IUserRow, "is_active">[]>;
  findAdmin(): Promise<Array<{ id: string }>>;
}
