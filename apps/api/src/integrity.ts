import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("Unsupported value in canonical JSON.");
  }
  return serialized;
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export type EvidenceManifest = {
  reportId: string;
  evidenceId: string;
  contentHash: string;
  mimeType: string;
  fileSize: number;
  submittedAt: string;
  recordVersion: 1;
};

export function hashEvidenceManifest(manifest: EvidenceManifest): string {
  return sha256(canonicalJson(manifest));
}

export function verifyEvidenceIntegrity(
  bytes: Buffer,
  expectedContentHash: string,
  manifest: EvidenceManifest,
  expectedManifestHash: string
): { contentMatches: boolean; manifestMatches: boolean; actualContentHash: string; actualManifestHash: string } {
  const actualContentHash = sha256(bytes);
  const actualManifestHash = hashEvidenceManifest(manifest);
  return {
    contentMatches: actualContentHash === expectedContentHash,
    manifestMatches: actualManifestHash === expectedManifestHash,
    actualContentHash,
    actualManifestHash
  };
}

export function hashAuditEvent(event: {
  caseNumber: string;
  previousStatus: string | null;
  newStatus: string;
  actorId: string;
  reason: string;
  createdAt: string;
  evidenceIds: string[];
}): string {
  return sha256(canonicalJson(event));
}
