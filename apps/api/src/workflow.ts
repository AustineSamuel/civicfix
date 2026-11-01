import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ReportStatus, Role } from "@prisma/client";

type TransitionContext = {
  roles: Role[];
  isReporter: boolean;
  isRepairClaimant: boolean;
};

const transitions: Partial<Record<ReportStatus, ReportStatus[]>> = {
  NEW: ["UNDER_REVIEW"],
  UNDER_REVIEW: ["NEEDS_MORE_INFORMATION", "REJECTED", "VERIFIED", "DUPLICATE"],
  NEEDS_MORE_INFORMATION: ["UNDER_REVIEW"],
  VERIFIED: ["ASSIGNED"],
  ASSIGNED: ["IN_PROGRESS"],
  IN_PROGRESS: ["REPAIR_REPORTED_COMPLETE"],
  REPAIR_REPORTED_COMPLETE: ["PENDING_INDEPENDENT_VERIFICATION"],
  PENDING_INDEPENDENT_VERIFICATION: ["REOPENED_FOR_REPAIR", "RESOLVED"],
  REOPENED_FOR_REPAIR: ["IN_PROGRESS"]
};

const reviewerRoles: Role[] = ["COMMUNITY_REVIEWER", "ADMINISTRATOR"];

export function assertStatusTransition(
  from: ReportStatus,
  to: ReportStatus,
  context: TransitionContext
): void {
  if (!transitions[from]?.includes(to)) {
    throw new BadRequestException(`The transition from ${from} to ${to} is not allowed.`);
  }

  if (to === "VERIFIED" && context.isReporter) {
    throw new ForbiddenException("Reviewers cannot verify their own reports.");
  }
  if ((to === "PENDING_INDEPENDENT_VERIFICATION" || to === "RESOLVED") &&
    context.isRepairClaimant) {
    throw new ForbiddenException("A repair claimant cannot independently verify their own completion.");
  }

  const { roles } = context;
  let allowed = false;
  switch (to) {
    case "UNDER_REVIEW":
      allowed = reviewerRoles.some((role) => roles.includes(role)) ||
        (from === "NEEDS_MORE_INFORMATION" && context.isReporter);
      break;
    case "NEEDS_MORE_INFORMATION":
    case "REJECTED":
    case "VERIFIED":
    case "DUPLICATE":
      allowed = reviewerRoles.some((role) => roles.includes(role));
      break;
    case "ASSIGNED":
      allowed = roles.includes("ADMINISTRATOR");
      break;
    case "IN_PROGRESS":
    case "REPAIR_REPORTED_COMPLETE":
      allowed = roles.includes("ORGANIZATION_REPRESENTATIVE") ||
        roles.includes("ADMINISTRATOR");
      break;
    case "PENDING_INDEPENDENT_VERIFICATION":
      allowed = (roles.includes("INDEPENDENT_VERIFIER") ||
        roles.includes("ADMINISTRATOR")) && !context.isRepairClaimant;
      break;
    case "RESOLVED":
    case "REOPENED_FOR_REPAIR":
      allowed = roles.includes("INDEPENDENT_VERIFIER") ||
        roles.includes("ADMINISTRATOR");
      break;
    default:
      allowed = false;
  }

  if (!allowed) {
    throw new ForbiddenException("Your role is not permitted to make this transition.");
  }
}
