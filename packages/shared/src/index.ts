import { z } from "zod";

export const reportStatuses = [
  "NEW",
  "UNDER_REVIEW",
  "NEEDS_MORE_INFORMATION",
  "REJECTED",
  "VERIFIED",
  "ASSIGNED",
  "IN_PROGRESS",
  "REPAIR_REPORTED_COMPLETE",
  "PENDING_INDEPENDENT_VERIFICATION",
  "REOPENED_FOR_REPAIR",
  "RESOLVED",
  "DUPLICATE"
] as const;

export type ReportStatus = (typeof reportStatuses)[number];

export const categories = [
  "ROAD",
  "STREETLIGHT",
  "WATER",
  "DRAINAGE",
  "SANITATION",
  "COMMUNITY_FACILITY",
  "OTHER"
] as const;

export const createReportSchema = z.object({
  title: z.string().trim().min(8).max(120),
  description: z.string().trim().min(20).max(4000),
  category: z.enum(categories),
  approximateLocation: z.string().trim().min(3).max(240),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  locationPrecision: z.enum(["APPROXIMATE", "EXACT"]).default("APPROXIMATE")
}).refine(
  (value) => (value.latitude === undefined) === (value.longitude === undefined),
  { message: "Latitude and longitude must be supplied together." }
);

export type CreateReportInput = z.infer<typeof createReportSchema>;
