import { Body, Controller, Get, Post } from "@nestjs/common";
import { UsersService } from "./users.service";
import { CreateUserDto } from "./user.dto";

@Controller("auth/users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  async create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto.email, dto.password, dto.role);
  }

  @Get()
  async list() {
    return this.usersService.list();
  }
}
