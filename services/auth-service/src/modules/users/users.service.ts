import {
  ConflictException,
  Inject,
  Injectable,
  OnModuleInit,
} from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { authServiceConfig } from "../../config";
import { hashSecret } from "../../utils/password";
import {
  USERS_REPOSITORY,
  type IUserRow,
  type IUsersRepository,
} from "./users.repository.interface";

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new PinoLoggerService(UsersService.name);

  constructor(
    @Inject(USERS_REPOSITORY)
    private readonly usersRepository: IUsersRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedAdmin();
  }

  /**
   * Registers a platform user with a hashed password.
   *
   * @param email - Unique login email.
   * @param password - Plain password (hashed before storage).
   * @param role - Application role string.
   * @returns Created user row without `is_active`.
   */
  async create(
    email: string,
    password: string,
    role: string,
  ): Promise<Omit<IUserRow, "is_active">> {
    const existing = await this.usersRepository.findByEmail(email);
    if (existing.length > 0) {
      throw new ConflictException(`User with email '${email}' already exists`);
    }

    const id = crypto.randomUUID();
    const passwordHash = await hashSecret(password);

    const rows = await this.usersRepository.insertUser({
      id,
      email,
      passwordHash,
      role,
    });

    this.logger.log(`Created user ${email} with role ${role}`);
    return rows[0] as Omit<IUserRow, "is_active">;
  }

  /**
   * @returns All active platform users (password hashes omitted by repository shape).
   */
  async list(): Promise<Omit<IUserRow, "is_active">[]> {
    const rows = await this.usersRepository.listActive();
    return rows as unknown as Omit<IUserRow, "is_active">[];
  }

  private async seedAdmin(): Promise<void> {
    const email = authServiceConfig.adminEmail;
    const password = authServiceConfig.adminPassword;
    if (!email || !password) return;

    const existing = await this.usersRepository.findAdmin();
    if (existing.length > 0) return;

    await this.create(email, password, "admin");
    this.logger.log(`Seeded admin user: ${email}`);
  }
}
