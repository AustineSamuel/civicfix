import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Post,
  UnauthorizedException,
  UseGuards
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Role } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { sign } from "jsonwebtoken";
import { z } from "zod";
import { PrismaService } from "./prisma.service.js";
import { AuthenticatedUser, CurrentUser, JwtAuthGuard, Public } from "./security.js";

const credentialsSchema = z.object({
  email: z.string().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128)
});

const registerSchema = credentialsSchema.extend({
  displayName: z.string().trim().min(2).max(80)
});

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(input: unknown): Promise<{ accessToken: string; user: AuthenticatedUser }> {
    const data = registerSchema.parse(input);
    const existing = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      throw new UnauthorizedException("Unable to create account with those credentials.");
    }

    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        displayName: data.displayName,
        passwordHash: await bcrypt.hash(data.password, 12),
        roles: { create: { role: Role.RESIDENT } }
      },
      include: { roles: { select: { role: true } } }
    });
    return this.issueToken(user.id, user.email, user.roles.map(({ role }) => role));
  }

  async login(input: unknown): Promise<{ accessToken: string; user: AuthenticatedUser }> {
    const data = credentialsSchema.parse(input);
    const user = await this.prisma.user.findUnique({
      where: { email: data.email },
      include: { roles: { select: { role: true } } }
    });
    if (!user || user.accountStatus !== "ACTIVE" || !(await bcrypt.compare(data.password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid email or password.");
    }
    return this.issueToken(user.id, user.email, user.roles.map(({ role }) => role));
  }

  async me(userId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { select: { role: true } } }
    });
    if (!user || user.accountStatus !== "ACTIVE") {
      throw new UnauthorizedException("Account is unavailable.");
    }
    return { sub: user.id, email: user.email, roles: user.roles.map(({ role }) => role) };
  }

  private issueToken(
    id: string,
    email: string,
    roles: Role[]
  ): { accessToken: string; user: AuthenticatedUser } {
    const user = { sub: id, email, roles };
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error("JWT_SECRET must be configured with at least 32 characters.");
    }
    return { accessToken: sign(user, secret, { expiresIn: "15m", issuer: "civicfix-api" }), user };
  }
}

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("register")
  @Throttle({ default: { ttl: 60_000, limit: 8 } })
  register(@Body() body: unknown) {
    return this.auth.register(body);
  }

  @Public()
  @Post("login")
  @Throttle({ default: { ttl: 60_000, limit: 8 } })
  login(@Body() body: unknown) {
    return this.auth.login(body);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.sub);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  @Post("logout")
  logout(): void {
    // Access tokens are short-lived and stateless; the client discards this token.
  }
}
