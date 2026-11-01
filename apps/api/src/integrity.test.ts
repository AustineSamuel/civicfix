import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  hashAuditEvent,
  hashEvidenceManifest,
  sha256,
  verifyEvidenceIntegrity
} from "./integrity.js";

describe("evidence and audit integrity helpers", () => {
  it("serializes object keys deterministically", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
  });

  it("hashes exact file bytes with SHA-256", () => {
    expect(sha256(Buffer.from("civicfix evidence"))).toBe(
      "b6a6a00ff8e69819ae2c20ebb281ec41eb76d20d238b55db856b1af5841b0dfc"
    );
  });

  it("produces stable audit digests", () => {
    const event = {
      caseNumber: "CF-TEST-1",
      previousStatus: "NEW",
      newStatus: "UNDER_REVIEW",
      actorId: "user-1",
      reason: "Review started",
      createdAt: "2026-01-01T00:00:00.000Z",
      evidenceIds: ["evidence-1"]
    };
    expect(hashAuditEvent(event)).toBe(hashAuditEvent(event));
    expect(hashAuditEvent(event)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("detects changed bytes and hashes a reproducible evidence manifest", () => {
    const bytes = Buffer.from("original image bytes");
    const manifest = {
      reportId: "report-1",
      evidenceId: "evidence-1",
      contentHash: sha256(bytes),
      mimeType: "image/png",
      fileSize: bytes.length,
      submittedAt: "2026-01-01T00:00:00.000Z",
      recordVersion: 1 as const
    };
    const manifestHash = hashEvidenceManifest(manifest);

    expect(verifyEvidenceIntegrity(bytes, manifest.contentHash, manifest, manifestHash))
      .toMatchObject({ contentMatches: true, manifestMatches: true });
    expect(verifyEvidenceIntegrity(Buffer.from("modified bytes"), manifest.contentHash, manifest, manifestHash))
      .toMatchObject({ contentMatches: false, manifestMatches: true });
  });
});
