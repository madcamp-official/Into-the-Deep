import { describe, expect, it } from "vitest";
import { buildUserProfile } from "../core/profile-builder";
import { buildGlanceAndForwardLeanSession, CALIBRATION_FRAMES } from "./v0-v1-comparison.fixtures";
import { compareV1ThresholdCandidates, formatThresholdSweepTable } from "./v0-v1-comparison";

// Sweeps V1's driftScore cutoff across candidates on the same session B is
// using to tune personalized-detector, so a threshold change can be judged
// by measured false-alert/detection numbers instead of by feel. This does
// not touch core/personalized-detector — every candidate is evaluated via
// options passed into replay, so it's safe to run alongside B's own
// tuning work on that file.
//
// glanceYawProxy=0.26 puts the sideways-glance driftScore at ~4 (given this
// fixture's zero-variance calibration, driftScore = yaw deviation / two
// normalizing features, i.e. |0.26-0.02|/0.03/2 = 4), landing it near the
// decision boundary across candidates 2-6 instead of the ~7.2 the default
// 0.45 fixture produces (used by v0-v1-comparison.test.ts to unambiguously
// show "still a problem" regardless of threshold).
describe("compareV1ThresholdCandidates", () => {
  const profile = buildUserProfile(CALIBRATION_FRAMES);
  const { entries, groundTruth } = buildGlanceAndForwardLeanSession(0.26);

  it("raising the driftScore cutoff reduces false alerts without losing the real drift", () => {
    const results = compareV1ThresholdCandidates(entries, profile, groundTruth, [2, 3, 4, 5, 6]);

    // The real FORWARD_LEAN segment should still be caught at every
    // candidate in this range — raising the cutoff shouldn't cost real
    // detections here.
    for (const result of results) {
      expect(result.metrics.sustainedDriftDetectionRate).toBe(1);
    }

    // False alerts from the sustained sideways glance should trend down
    // (or at least never go up) as the cutoff rises, and should disappear
    // once the cutoff passes the glance's own driftScore.
    for (let i = 1; i < results.length; i++) {
      expect(results[i].metrics.falseAlertsPerHour).toBeLessThanOrEqual(
        results[i - 1].metrics.falseAlertsPerHour,
      );
    }
    expect(results[results.length - 1].metrics.falseAlertsPerHour).toBe(0);
  });

  it("formats a readable per-threshold sweep table", () => {
    const results = compareV1ThresholdCandidates(entries, profile, groundTruth, [3, 4, 5]);
    const table = formatThresholdSweepTable(results);

    expect(table).toContain("driftScore >=");
    expect(table).toContain("false alerts / hour");
    expect(table).toContain("detection rate");
  });
});
