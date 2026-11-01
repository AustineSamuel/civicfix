import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AdminController, AdminService, OrganizationController } from "./admin.js";
import { AuthController, AuthService } from "./auth.js";
import { BlockchainAdminController, BlockchainController, BlockchainService } from "./blockchain.js";
import { PrismaService } from "./prisma.service.js";
import { EvidenceController, ReportsController, ReportsService } from "./reports.js";
import { JwtAuthGuard, RolesGuard } from "./security.js";

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])],
  controllers: [
    AuthController,
    ReportsController,
    EvidenceController,
    OrganizationController,
    AdminController,
    BlockchainController,
    BlockchainAdminController
  ],
  providers: [
    PrismaService,
    AuthService,
    ReportsService,
    AdminService,
    BlockchainService,
    JwtAuthGuard,
    RolesGuard,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard }
  ]
})
export class AppModule {}
