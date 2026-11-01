import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  StreamableFile,
  Query,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  Category,
  EvidenceType,
  Prisma,
  ReportStatus,
  Role
} from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { createReportSchema, reportStatuses } from "@civicfix/shared";
import { PrismaService } from "./prisma.service.js";
import { AuthenticatedUser, CurrentUser, Public, Roles } from "./security.js";
import {
  hashAuditEvent,
  hashEvidenceManifest,
  sha256,
  verifyEvidenceIntegrity
} from "./integrity.js";
import { assertStatusTransition } from "./workflow.js";

const transitionSchema = z.object({
  status: z.enum(reportStatuses),
  reason: z.string().trim().min(8).max(500),
  evidenceIds: z.array(z.string().min(1)).max(20).default([])
});
const assignSchema = z.object({
  organizationId: z.string().min(1),
  reason: z.string().trim().min(8).max(500)
});
const listSchema = z.object({
  category: z.nativeEnum(Category).optional(),
  status: z.nativeEnum(ReportStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().trim().max(120).optional()
});

type PublicReport = {
  id: string;
  publicCaseNumber: string;
  title: string;
  description: string;
  category: Category;
  approximateLocation: string;
  currentStatus: ReportStatus;
  createdAt: Date;
  updatedAt: Date;
  evidenceCount: number;
};

type UploadedEvidenceFile = {
  mimetype: string;
  size: number;
  buffer: Buffer;
};

const organizationProgressStatuses: ReportStatus[] = [
  ReportStatus.IN_PROGRESS,
  ReportStatus.REPAIR_REPORTED_COMPLETE
];
const reviewRoles: Role[] = [Role.COMMUNITY_REVIEWER, Role.ADMINISTRATOR];
const privilegedEvidenceRoles: Role[] = [
  Role.COMMUNITY_REVIEWER,
  Role.INDEPENDENT_VERIFIER,
  Role.ADMINISTRATOR
];

function publicReport(report: {
  id: string;
  publicCaseNumber: string;
  title: string;
  description: string;
  category: Category;
  approximateLocation: string;
  currentStatus: ReportStatus;
  createdAt: Date;
  updatedAt: Date;
  _count: { evidence: number };
}): PublicReport {
  return {
    id: report.id,
    publicCaseNumber: report.publicCaseNumber,
    title: report.title,
    description: report.description,
    category: report.category,
    approximateLocation: report.approximateLocation,
    currentStatus: report.currentStatus,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    evidenceCount: report._count.evidence
  };
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: unknown, actor: AuthenticatedUser): Promise<PublicReport> {
    const data = createReportSchema.parse(input);
    if (!actor.roles.includes(Role.RESIDENT) && !actor.roles.includes(Role.ADMINISTRATOR)) {
      throw new ForbiddenException("Only residents can submit public reports.");
    }

    const now = new Date();
    const caseNumber = `CF-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
    const auditEventHash = hashAuditEvent({
      caseNumber,
      previousStatus: null,
      newStatus: ReportStatus.NEW,
      actorId: actor.sub,
      reason: "Resident submitted report",
      createdAt: now.toISOString(),
      evidenceIds: []
    });

    const result = await this.prisma.$transaction(async (transaction) => {
      const report = await transaction.report.create({
        data: {
          publicCaseNumber: caseNumber,
          title: data.title,
          description: data.description,
          category: data.category,
          approximateLocation: data.approximateLocation,
          latitude: data.latitude,
          longitude: data.longitude,
          locationPrecision: data.locationPrecision,
          reporterId: actor.sub,
          createdAt: now
        },
        include: { _count: { select: { evidence: true } } }
      });
      await transaction.statusHistory.create({
        data: {
          reportId: report.id,
          previousStatus: null,
          newStatus: ReportStatus.NEW,
          actorId: actor.sub,
          reason: "Resident submitted report",
          auditEventHash,
          createdAt: now
        }
      });
      await transaction.auditEvent.create({
        data: {
          actorId: actor.sub,
          action: "REPORT_CREATED",
          subjectId: report.id,
          metadata: { caseNumber, auditEventHash }
        }
      });
      return report;
    });
    return publicReport(result);
  }

  async list(query: unknown) {
    const filters = listSchema.parse(query);
    const where: Prisma.ReportWhereInput = {
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.status ? { currentStatus: filters.status } : {}),
      ...(filters.search ? {
        OR: [
          { publicCaseNumber: { contains: filters.search, mode: "insensitive" } },
          { title: { contains: filters.search, mode: "insensitive" } }
        ]
      } : {})
    };
    const [reports, total] = await this.prisma.$transaction([
      this.prisma.report.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
        include: { _count: { select: { evidence: true } } }
      }),
      this.prisma.report.count({ where })
    ]);
    return {
      data: reports.map(publicReport),
      page: filters.page,
      pageSize: filters.pageSize,
      total
    };
  }

  async get(reportId: string): Promise<PublicReport> {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: { _count: { select: { evidence: true } } }
    });
    if (!report) {
      throw new NotFoundException("Report not found.");
    }
    return publicReport(report);
  }

  async history(reportId: string) {
    await this.get(reportId);
    const entries = await this.prisma.statusHistory.findMany({
      where: { reportId },
      orderBy: { createdAt: "asc" },
      select: {
        previousStatus: true,
        newStatus: true,
        reason: true,
        auditEventHash: true,
        blockchainStatus: true,
        transactionHash: true,
        evidenceIds: true,
        createdAt: true
      }
    });
    return entries;
  }

  async transition(reportId: string, input: unknown, actor: AuthenticatedUser) {
    const { status, reason, evidenceIds } = transitionSchema.parse(input);
    if (status === ReportStatus.ASSIGNED) {
      throw new BadRequestException("Use the assignment endpoint to assign an organization.");
    }
    return this.prisma.$transaction(async (transaction) => {
      const report = await transaction.report.findUnique({ where: { id: reportId } });
      if (!report) {
        throw new NotFoundException("Report not found.");
      }
      if (actor.roles.includes(Role.ORGANIZATION_REPRESENTATIVE) &&
        organizationProgressStatuses.includes(status)) {
        const membership = report.organizationId
          ? await transaction.organizationMembership.findUnique({
            where: {
              organizationId_userId: {
                organizationId: report.organizationId,
                userId: actor.sub
              }
            }
          })
          : null;
        if (!membership) {
          throw new ForbiddenException("You are not a member of the organization assigned to this report.");
        }
      }
      const evidence = evidenceIds.length
        ? await transaction.evidence.findMany({
          where: { id: { in: evidenceIds }, reportId },
          select: { id: true, uploaderId: true, evidenceType: true }
        })
        : [];
      if (evidenceIds.length !== new Set(evidenceIds).size ||
        evidence.length !== new Set(evidenceIds).size) {
        throw new BadRequestException("Each evidence reference must belong to this report and be unique.");
      }
      if (status === ReportStatus.REPAIR_REPORTED_COMPLETE &&
        !evidence.some((item) => item.uploaderId === actor.sub && item.evidenceType === EvidenceType.REPAIR)) {
        throw new BadRequestException("Attach repair evidence submitted by the assigned organization representative.");
      }
      assertStatusTransition(report.currentStatus, status, {
        roles: actor.roles,
        isReporter: report.reporterId === actor.sub,
        isRepairClaimant: report.repairClaimantId === actor.sub
      });

      const now = new Date();
      const auditEventHash = hashAuditEvent({
        caseNumber: report.publicCaseNumber,
        previousStatus: report.currentStatus,
        newStatus: status,
        actorId: actor.sub,
        reason,
        createdAt: now.toISOString(),
        evidenceIds: [...evidenceIds].sort()
      });
      await transaction.report.update({
        where: { id: reportId },
        data: {
          currentStatus: status,
          ...(status === ReportStatus.REPAIR_REPORTED_COMPLETE ? { repairClaimantId: actor.sub } : {})
        }
      });
      const history = await transaction.statusHistory.create({
        data: {
          reportId,
          previousStatus: report.currentStatus,
          newStatus: status,
          actorId: actor.sub,
          reason,
          evidenceIds,
          auditEventHash,
          createdAt: now
        }
      });
      await transaction.auditEvent.create({
        data: {
          actorId: actor.sub,
          action: "REPORT_STATUS_CHANGED",
          subjectId: reportId,
          metadata: { from: report.currentStatus, to: status, auditEventHash }
        }
      });
      return { status, auditEventHash, createdAt: history.createdAt };
    });
  }

  async assign(reportId: string, input: unknown, actor: AuthenticatedUser) {
    const { organizationId, reason } = assignSchema.parse(input);
    return this.prisma.$transaction(async (transaction) => {
      const report = await transaction.report.findUnique({ where: { id: reportId } });
      const organization = await transaction.organization.findUnique({ where: { id: organizationId } });
      if (!report || !organization) {
        throw new NotFoundException("Report or organization not found.");
      }
      if (report.currentStatus !== ReportStatus.VERIFIED) {
        throw new BadRequestException("Only verified reports can be assigned.");
      }
      if (organization.verificationStatus !== "VERIFIED") {
        throw new BadRequestException("The organization is not verified for assignments.");
      }
      const now = new Date();
      const auditEventHash = hashAuditEvent({
        caseNumber: report.publicCaseNumber,
        previousStatus: report.currentStatus,
        newStatus: ReportStatus.ASSIGNED,
        actorId: actor.sub,
        reason,
        createdAt: now.toISOString(),
        evidenceIds: []
      });
      await transaction.report.update({
        where: { id: reportId },
        data: { currentStatus: ReportStatus.ASSIGNED, organizationId }
      });
      await transaction.statusHistory.create({
        data: {
          reportId,
          previousStatus: report.currentStatus,
          newStatus: ReportStatus.ASSIGNED,
          actorId: actor.sub,
          reason,
          auditEventHash,
          createdAt: now
        }
      });
      await transaction.auditEvent.create({
        data: {
          actorId: actor.sub,
          action: "REPORT_ASSIGNED",
          subjectId: reportId,
          metadata: { organizationId, auditEventHash }
        }
      });
      return { status: ReportStatus.ASSIGNED, auditEventHash, createdAt: now };
    });
  }

  async uploadEvidence(
    reportId: string,
    actor: AuthenticatedUser,
    file: UploadedEvidenceFile,
    evidenceTypeInput: unknown
  ) {
    if (!file) {
      throw new BadRequestException("An image file is required.");
    }
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report) {
      throw new NotFoundException("Report not found.");
    }
    const evidenceType = z.nativeEnum(EvidenceType).default(EvidenceType.INITIAL_REPORT).parse(evidenceTypeInput);
    if (evidenceType === EvidenceType.REPAIR) {
      const membership = report.organizationId && actor.roles.includes(Role.ORGANIZATION_REPRESENTATIVE)
        ? await this.prisma.organizationMembership.findUnique({
          where: {
            organizationId_userId: {
              organizationId: report.organizationId,
              userId: actor.sub
            }
          }
        })
        : null;
      if (!membership || !organizationProgressStatuses.includes(report.currentStatus)) {
        throw new ForbiddenException("Only a representative of the assigned organization can add repair evidence.");
      }
    } else if (evidenceType === EvidenceType.INITIAL_REPORT || evidenceType === EvidenceType.ADDITIONAL_INFORMATION) {
      if (report.reporterId !== actor.sub &&
        !actor.roles.some((role) => reviewRoles.includes(role))) {
        throw new ForbiddenException("You cannot add evidence to this report.");
      }
    } else if (!actor.roles.some((role) => reviewRoles.includes(role))) {
      throw new ForbiddenException("You cannot add evidence to this report.");
    }
    const maxBytes = Number(process.env.MAX_EVIDENCE_BYTES ?? 10 * 1024 * 1024);
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || file.size > maxBytes) {
      throw new BadRequestException("Evidence exceeds the configured file-size limit.");
    }
    if (!this.hasValidImageSignature(file.buffer, file.mimetype)) {
      throw new BadRequestException("Only valid JPEG, PNG, or WebP images are accepted.");
    }

    const id = randomUUID();
    const ext = file.mimetype === "image/jpeg" ? ".jpg" : file.mimetype === "image/png" ? ".png" : ".webp";
    const storageKey = `${id}${ext}`;
    const contentHash = sha256(file.buffer);
    const createdAt = new Date();
    const manifest = {
      reportId,
      evidenceId: id,
      contentHash,
      mimeType: file.mimetype,
      fileSize: file.size,
      submittedAt: createdAt.toISOString(),
      recordVersion: 1 as const
    };
    const manifestHash = hashEvidenceManifest(manifest);
    const storageDirectory = resolve(process.cwd(), process.env.EVIDENCE_STORAGE_DIR ?? "./storage");
    const path = resolve(storageDirectory, storageKey);
    if (!path.startsWith(`${storageDirectory}/`)) {
      throw new BadRequestException("Invalid evidence storage key.");
    }
    await mkdir(storageDirectory, { recursive: true, mode: 0o700 });
    await writeFile(path, file.buffer, { flag: "wx", mode: 0o600 });
    try {
      const evidence = await this.prisma.evidence.create({
        data: {
          id,
          reportId,
          uploaderId: actor.sub,
          storageKey,
          contentHash,
          manifestHash,
          mimeType: file.mimetype,
          fileSize: file.size,
          evidenceType,
          createdAt
        },
        select: {
          id: true,
          contentHash: true,
          manifestHash: true,
          mimeType: true,
          fileSize: true,
          createdAt: true
        }
      });
      return evidence;
    } catch (error) {
      await unlink(path);
      throw error;
    }
  }

  async listEvidence(reportId: string, actor: AuthenticatedUser) {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report) {
      throw new NotFoundException("Report not found.");
    }
    this.assertEvidenceAccess(report.reporterId, actor);
    return this.prisma.evidence.findMany({
      where: { reportId },
      select: {
        id: true,
        contentHash: true,
        manifestHash: true,
        mimeType: true,
        fileSize: true,
        evidenceType: true,
        createdAt: true
      },
      orderBy: { createdAt: "asc" }
    });
  }

  async evidenceFile(evidenceId: string, actor: AuthenticatedUser) {
    const evidence = await this.prisma.evidence.findUnique({
      where: { id: evidenceId },
      include: { report: { select: { reporterId: true } } }
    });
    if (!evidence) {
      throw new NotFoundException("Evidence not found.");
    }
    this.assertEvidenceAccess(evidence.report.reporterId, actor, evidence.uploaderId);
    const storageDirectory = resolve(process.cwd(), process.env.EVIDENCE_STORAGE_DIR ?? "./storage");
    const path = resolve(storageDirectory, evidence.storageKey);
    if (!path.startsWith(`${storageDirectory}/`)) {
      throw new BadRequestException("Invalid evidence storage key.");
    }
    return { buffer: await readFile(path), mimeType: evidence.mimeType };
  }

  async verifyEvidence(evidenceId: string, actor: AuthenticatedUser) {
    const evidence = await this.prisma.evidence.findUnique({
      where: { id: evidenceId },
      include: { report: { select: { reporterId: true } } }
    });
    if (!evidence) {
      throw new NotFoundException("Evidence not found.");
    }
    this.assertEvidenceAccess(evidence.report.reporterId, actor, evidence.uploaderId);
    const storageDirectory = resolve(process.cwd(), process.env.EVIDENCE_STORAGE_DIR ?? "./storage");
    const path = resolve(storageDirectory, evidence.storageKey);
    if (!path.startsWith(`${storageDirectory}/`)) {
      throw new BadRequestException("Invalid evidence storage key.");
    }
    const bytes = await readFile(path);
    const integrity = verifyEvidenceIntegrity(
      bytes,
      evidence.contentHash,
      {
        reportId: evidence.reportId,
        evidenceId: evidence.id,
        contentHash: evidence.contentHash,
        mimeType: evidence.mimeType,
        fileSize: evidence.fileSize,
        submittedAt: evidence.createdAt.toISOString(),
        recordVersion: 1
      },
      evidence.manifestHash
    );
    return {
      evidenceId,
      expectedHash: evidence.contentHash,
      actualHash: integrity.actualContentHash,
      expectedManifestHash: evidence.manifestHash,
      actualManifestHash: integrity.actualManifestHash,
      contentMatches: integrity.contentMatches,
      manifestMatches: integrity.manifestMatches,
      verified: integrity.contentMatches && integrity.manifestMatches
    };
  }

  private assertEvidenceAccess(reporterId: string, actor: AuthenticatedUser, uploaderId?: string): void {
    if (reporterId === actor.sub || uploaderId === actor.sub ||
      actor.roles.some((role) => privilegedEvidenceRoles.includes(role))) {
      return;
    }
    throw new ForbiddenException("You do not have access to this evidence.");
  }

  private hasValidImageSignature(buffer: Buffer, mimeType: string): boolean {
    if (mimeType === "image/jpeg") {
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    }
    if (mimeType === "image/png") {
      return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    }
    if (mimeType === "image/webp") {
      return buffer.length >= 12 &&
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP";
    }
    return false;
  }
}

@ApiTags("reports")
@Controller("reports")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @ApiBearerAuth()
  create(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.create(body, user);
  }

  @Get()
  @Public()
  list(@Query() query: unknown) {
    return this.reports.list(query);
  }

  @Get(":reportId")
  @Public()
  get(@Param("reportId") reportId: string) {
    return this.reports.get(reportId);
  }

  @Get(":reportId/history")
  @Public()
  history(@Param("reportId") reportId: string) {
    return this.reports.history(reportId);
  }

  @Post(":reportId/status")
  @ApiBearerAuth()
  transition(
    @Param("reportId") reportId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.reports.transition(reportId, body, user);
  }

  @Post(":reportId/assignments")
  @ApiBearerAuth()
  @Roles(Role.ADMINISTRATOR)
  assign(
    @Param("reportId") reportId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.reports.assign(reportId, body, user);
  }

  @Post(":reportId/evidence")
  @ApiBearerAuth()
  @UseInterceptors(FileInterceptor("file", {
    limits: { fileSize: Number(process.env.MAX_EVIDENCE_BYTES ?? 10 * 1024 * 1024) }
  }))
  uploadEvidence(
    @Param("reportId") reportId: string,
    @UploadedFile() file: UploadedEvidenceFile,
    @Body("evidenceType") evidenceType: unknown,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.reports.uploadEvidence(reportId, user, file, evidenceType);
  }

  @Get(":reportId/evidence")
  @ApiBearerAuth()
  listEvidence(
    @Param("reportId") reportId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.reports.listEvidence(reportId, user);
  }
}

@ApiTags("evidence")
@ApiBearerAuth()
@Controller("evidence")
export class EvidenceController {
  constructor(private readonly reports: ReportsService) {}

  @Get(":evidenceId")
  async get(@Param("evidenceId") evidenceId: string, @CurrentUser() user: AuthenticatedUser) {
    const evidence = await this.reports.evidenceFile(evidenceId, user);
    return new StreamableFile(evidence.buffer, {
      type: evidence.mimeType,
      disposition: "inline",
      length: evidence.buffer.length
    });
  }

  @Post(":evidenceId/verify-integrity")
  verify(@Param("evidenceId") evidenceId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.verifyEvidence(evidenceId, user);
  }
}
