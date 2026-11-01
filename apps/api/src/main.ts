import "reflect-metadata";
import { resolve } from "node:path";
import dotenv from "dotenv";
import helmet from "helmet";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";
import { CivicFixExceptionFilter } from "./errors.js";

dotenv.config({ path: resolve(process.cwd(), "../../.env") });

async function bootstrap(): Promise<void> {
  const jwtSecret = process.env.JWT_SECRET;
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be configured in civicfix/.env.");
  }
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be set to at least 32 characters in civicfix/.env.");
  }
  const app = await NestFactory.create(AppModule, { cors: false });
  app.use(helmet());
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false
  });
  app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(new CivicFixExceptionFilter());

  const openApi = new DocumentBuilder()
    .setTitle("CivicFix API")
    .setDescription("Infrastructure reports, evidence integrity, and audit history.")
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, openApi));

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
  console.log(`CivicFix API listening on http://localhost:${port}/api/v1`);
}

void bootstrap();
