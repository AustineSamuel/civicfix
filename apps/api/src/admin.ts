import {
  Body,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { z } from "zod";
import { PrismaService } from "./prisma.service.js";
import { AuthenticatedUser, CurrentUser, Public, Roles } from "./security.js";

const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(10).max(1000),
  organizationType: z.string().trim().min(2).max(80)
});
const memberSchema = z.object({ userId: z.string().min(1) });
const roleSchema = z.object({ role: z.nativeEnum(Role) });
const verificationSchema = z.object({ verified: z.boolean() });

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  listOrganizations() {
    return this.prisma.organization.findMany({
      where: { verificationStatus: "VERIFIED" },
      select: { id: true, name: true, description: true, organizationType: true },
      orderBy: { name: "asc" }
    });
  }

  async createOrganization(input: unknown, actor: AuthenticatedUser) {
    const data = createOrganizationSchema.parse(input);
    const organization = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.organization.create({
        data: { ...data },
        select: { id: true, name: true, verificationStatus: true, createdAt: true }
      });
      await transaction.auditEvent.create({
        data: {
          actorId: actor.sub,
          action: "ORGANIZATION_CREATED",
          subjectId: created.id,
          metadata: { name: created.name }
        }
      });
      return created;
    });
    return organization;
  }

  async verifyOrganization(organizationId: string, input: unknown, actor: AuthenticatedUser) {
    const { verified } = verificationSchema.parse(input);
    const organization = await this.prisma.$transaction(async (transaction) => {
      const found = await transaction.organization.findUnique({ where: { id: organizationId } });
      if (!found) {
        throw new NotFoundException("Organization not found.");
      }
      const updated = await transaction.organization.update({
        where: { id: organizationId },
        data: { verificationStatus: verified ? "VERIFIED" : "REJECTED" },
        select: { id: true, name: true, verificationStatus: true }
      });
      await transaction.auditEvent.create({
        data: {
          actorId: actor.sub,
          action: "ORGANIZATION_VERIFICATION_CHANGED",
          subjectId: organizationId,
          metadata: { verificationStatus: updated.verificationStatus }
        }
      });
      return updated;
    });
    return organization;
  }

  async addMember(organizationId: string, input: unknown, actor: AuthenticatedUser) {
    const { userId } = memberSchema.parse(input);
    return this.prisma.$transaction(async (transaction) => {
      const [organization, user] = await Promise.all([
        transaction.organization.findUnique({ where: { id: organizationId } }),
        transaction.user.findUnique({ where: { id: userId } })
      ]);
      if (!organization || !user) {
        throw new NotFoundException("Organization or user not found.");
      }
      const member = await transaction.organizationMembership.upsert({
        where: { organizationId_userId: { organizationId, userId } },
        create: { organizationId, userId, permission: "MAINTAIN_CASES" },
        update: { permission: "MAINTAIN_CASES" }
      });
      await transaction.userRole.upsert({
        where: { userId_role: { userId, role: Role.ORGANIZATION_REPRESENTATIVE } },
        create: { userId, role: Role.ORGANIZATION_REPRESENTATIVE, grantedBy: actor.sub },
        update: { grantedBy: actor.sub }
      });
      await transaction.auditEvent.create({
        data: {
          actorId: actor.sub,
          action: "ORGANIZATION_MEMBER_ADDED",
          subjectId: organizationId,
          metadata: { userId }
        }
      });
      return { organizationId: member.organizationId, userId: member.userId };
    });
  }

  async grantRole(userId: string, input: unknown, actor: AuthenticatedUser) {
    const { role } = roleSchema.parse(input);
    return this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new NotFoundException("User not found.");
      }
      const assignment = await transaction.userRole.upsert({
        where: { userId_role: { userId, role } },
        create: { userId, role, grantedBy: actor.sub },
        update: { grantedBy: actor.sub }
      });
      await transaction.auditEvent.create({
        data: {
          actorId: actor.sub,
          action: "USER_ROLE_GRANTED",
          subjectId: userId,
          metadata: { role }
        }
      });
      return { userId: assignment.userId, role: assignment.role };
    });
  }

  async listAuditEvents(query: unknown) {
    const parsed = z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(50)
    }).parse(query);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditEvent.findMany({
        orderBy: { createdAt: "desc" },
        skip: (parsed.page - 1) * parsed.pageSize,
        take: parsed.pageSize,
        select: {
          id: true,
          actorId: true,
          action: true,
          subjectId: true,
          metadata: true,
          createdAt: true
        }
      }),
      this.prisma.auditEvent.count()
    ]);
    return { data, page: parsed.page, pageSize: parsed.pageSize, total };
  }
}

@ApiTags("organizations")
@Controller("organizations")
export class OrganizationController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  @Public()
  list() {
    return this.admin.listOrganizations();
  }

  @Post()
  @ApiBearerAuth()
  @Roles(Role.ADMINISTRATOR)
  create(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.admin.createOrganization(body, user);
  }

  @Patch(":organizationId/verification")
  @ApiBearerAuth()
  @Roles(Role.ADMINISTRATOR)
  verify(
    @Param("organizationId") organizationId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.admin.verifyOrganization(organizationId, body, user);
  }

  @Post(":organizationId/members")
  @ApiBearerAuth()
  @Roles(Role.ADMINISTRATOR)
  addMember(
    @Param("organizationId") organizationId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.admin.addMember(organizationId, body, user);
  }
}

@ApiTags("administration")
@ApiBearerAuth()
@Roles(Role.ADMINISTRATOR)
@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post("users/:userId/roles")
  grantRole(
    @Param("userId") userId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.admin.grantRole(userId, body, user);
  }

  @Get("audit-events")
  auditEvents(@Query() query: unknown) {
    return this.admin.listAuditEvents(query);
  }
}
