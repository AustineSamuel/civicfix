import { describe, expect, it } from "vitest";
import { Role, ReportStatus } from "@prisma/client";
import { assertStatusTransition } from "./workflow.js";

const context = (roles: Role[], extras: { isReporter?: boolean; isRepairClaimant?: boolean } = {}) => ({
  roles,
  isReporter: extras.isReporter ?? false,
  isRepairClaimant: extras.isRepairClaimant ?? false
});

describe("report workflow", () => {
  it("allows a reviewer to verify a report after review", () => {
    expect(() => assertStatusTransition(
      ReportStatus.UNDER_REVIEW,
      ReportStatus.VERIFIED,
      context([Role.COMMUNITY_REVIEWER])
    )).not.toThrow();
  });

  it("prevents residents from verifying reports", () => {
    expect(() => assertStatusTransition(
      ReportStatus.UNDER_REVIEW,
      ReportStatus.VERIFIED,
      context([Role.RESIDENT])
    )).toThrow();
  });

  it("prevents reviewers from verifying their own reports", () => {
    expect(() => assertStatusTransition(
      ReportStatus.UNDER_REVIEW,
      ReportStatus.VERIFIED,
      context([Role.COMMUNITY_REVIEWER], { isReporter: true })
    )).toThrow(/own reports/);
  });

  it("prevents skipped workflow stages", () => {
    expect(() => assertStatusTransition(
      ReportStatus.NEW,
      ReportStatus.RESOLVED,
      context([Role.ADMINISTRATOR])
    )).toThrow();
  });

  it("prevents the repair claimant from independently verifying completion", () => {
    expect(() => assertStatusTransition(
      ReportStatus.REPAIR_REPORTED_COMPLETE,
      ReportStatus.PENDING_INDEPENDENT_VERIFICATION,
      context([Role.INDEPENDENT_VERIFIER], { isRepairClaimant: true })
    )).toThrow();
  });

  it("prevents the repair claimant from marking the report resolved", () => {
    expect(() => assertStatusTransition(
      ReportStatus.PENDING_INDEPENDENT_VERIFICATION,
      ReportStatus.RESOLVED,
      context([Role.INDEPENDENT_VERIFIER], { isRepairClaimant: true })
    )).toThrow(/repair claimant/);
  });
});
