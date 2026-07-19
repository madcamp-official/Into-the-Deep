import { describe, expect, it } from "vitest";
import { buildUserProfile } from "../core/profile-builder";
import { compareV0AndV1, formatComparisonTable } from "./v0-v1-comparison";
import { CALIBRATION_FRAMES, GROUND_TRUTH, SESSION_ENTRIES } from "./v0-v1-comparison.fixtures";

describe("compareV0AndV1", () => {
  const profile = buildUserProfile(CALIBRATION_FRAMES);

  it("both detectors catch the real forward-lean drift", () => {
    const result = compareV0AndV1(SESSION_ENTRIES, profile, GROUND_TRUTH, {});

    expect(result.v0.metrics.sustainedDriftDetectionRate).toBe(1);
    expect(result.v1.metrics.sustainedDriftDetectionRate).toBe(1);
  });

  // Known V1 gap (see docs/C_structure.md "실패 사례"): personalization
  // alone does not exempt a sustained sideways head-turn from being scored
  // as drift, so turning to talk to a neighbor for more than
  // sustainedSeconds still reads as a false alert on both V0 and V1. This
  // test documents today's behavior; flip it to `not.toBeGreaterThan(0)`
  // once V1 gets a "yaw-dominant => not bad" exception.
  it("neither V0 nor V1 currently exempt a sustained sideways glance", () => {
    const result = compareV0AndV1(SESSION_ENTRIES, profile, GROUND_TRUTH, {});

    expect(result.v0.metrics.falseAlertsPerHour).toBeGreaterThan(0);
    expect(result.v1.metrics.falseAlertsPerHour).toBeGreaterThan(0);
  });

  it("formats a readable comparison table", () => {
    const result = compareV0AndV1(SESSION_ENTRIES, profile, GROUND_TRUTH, {});
    const table = formatComparisonTable(result);

    expect(table).toContain("false alerts / hour");
    expect(table).toContain("sustained drift detection rate");
    expect(table).toContain("avg detection delay (s)");
  });
});
