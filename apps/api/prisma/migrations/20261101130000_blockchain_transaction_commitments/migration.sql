ALTER TYPE "BlockchainStatus" ADD VALUE 'SUBMITTING' AFTER 'NOT_SUBMITTED';

ALTER TABLE "BlockchainTransaction"
ADD COLUMN "caseIdentifier" TEXT NOT NULL DEFAULT '',
ADD COLUMN "commitment" TEXT NOT NULL DEFAULT '',
ADD COLUMN "evidenceIdentifier" TEXT;

ALTER TABLE "BlockchainTransaction"
ALTER COLUMN "caseIdentifier" DROP DEFAULT,
ALTER COLUMN "commitment" DROP DEFAULT;
