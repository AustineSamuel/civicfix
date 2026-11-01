import { describe, expect, it } from "vitest";
import { createReportSchema } from "./index.js";

describe("createReportSchema", () => {
  it("rejects coordinates supplied as a partial pair", () => {
    expect(createReportSchema.safeParse({
      title: "Damaged road surface",
      description: "A deep pothole is present near the public bus stop.",
      category: "ROAD",
      approximateLocation: "Near the central bus stop",
      latitude: 51.5
    }).success).toBe(false);
  });
});
