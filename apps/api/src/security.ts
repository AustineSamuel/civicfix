import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "@prisma/client";
import { Request as ExpressRequest } from "express";
import { verify } from "jsonwebtoken";
import { z } from "zod";

export type AuthenticatedUser = {
  sub: string;
  email: string;
  roles: Role[];
};

type AuthenticatedRequest = ExpressRequest & { user?: AuthenticatedUser };
const PUBLIC_KEY = "civicfix_public";
const ROLES_KEY = "civicfix_roles";
const tokenSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  roles: z.array(z.nativeEnum(Role))
});

export const Public = () => SetMetadata(PUBLIC_KEY, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new UnauthorizedException();
    }
    return request.user;
  }
);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const token = authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
    const secret = process.env.JWT_SECRET;
    if (!token || !secret || secret.length < 32) {
      throw new UnauthorizedException("A valid bearer token is required.");
    }

    try {
      const payload = tokenSchema.parse(verify(token, secret, { issuer: "civicfix-api" }));
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException("A valid bearer token is required.");
    }
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (!roles?.length) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return roles.some((role) => request.user?.roles.includes(role) === true);
  }
}
