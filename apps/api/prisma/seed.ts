import { resolve } from "node:path";
import dotenv from "dotenv";
import { PrismaClient, Role } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();
dotenv.config({ path: resolve(process.cwd(), "../../.env") });

async function seed(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL?.toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const displayName = process.env.SEED_ADMIN_DISPLAY_NAME ?? "CivicFix Administrator";
  if (!email || !password || password.length < 16) {
    throw new Error(
      "Set SEED_ADMIN_EMAIL and a SEED_ADMIN_PASSWORD of at least 16 characters before seeding."
    );
  }

  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      displayName,
      passwordHash: await bcrypt.hash(password, 12),
      roles: { create: { role: Role.ADMINISTRATOR } }
    },
    update: {}
  });
  await prisma.userRole.upsert({
    where: { userId_role: { userId: user.id, role: Role.ADMINISTRATOR } },
    create: { userId: user.id, role: Role.ADMINISTRATOR },
    update: {}
  });
  console.log(`Seeded administrator account ${email}.`);
}

seed()
  .catch((error: unknown) => {
    console.error("CivicFix seed failed", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
