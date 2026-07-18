import { describe, expect, it } from "vitest";
import { buildUserProfile } from "../core/profile-builder";
import type { FrameFeature, ScenarioLabel } from "../core/types";
import { compareV0AndV1, formatComparisonTable } from "./v0-v1-comparison";
import type { SessionLogEntry } from "./recorder";

// Calibration done once, facing forward, before the session below —
// mirrors an in-app Calibration click.
const CALIBRATION_FRAMES: FrameFeature[] = [0, 1000, 2000, 3000, 4000].map((timestamp) => ({
  timestamp,
  confidence: 0.95,
  shoulderTilt: 1.5,
  headXOffset: 0.02,
  shoulderXOffset: 0.5,
  shoulderYOffset: 0.4,
  bodyScale: 1.0,
  faceToShoulderRatio: 0.2,
  pitchProxy: 0.15,
  yawProxy: 0.02,
  motionEnergy: 0.03,
}));

function neutralEntry(timestamp: number, groundTruth: ScenarioLabel["label"]): SessionLogEntry {
  return {
    timestamp,
    groundTruth,
    cameraState: "VALID",
    confidence: 0.95,
    features: {
      shoulderTilt: 1.5,
      headXOffset: 0.02,
      shoulderXOffset: 0.5,
      shoulderYOffset: 0.4,
      bodyScale: 1.0,
      faceToShoulderRatio: 0.2,
      pitchProxy: 0.15,
      yawProxy: 0.02,
      motionEnergy: 0.03,
    },
  };
}

// A session with two segments that should be judged very differently:
// - 5s-9s: turning to talk to a neighbor. Ground truth stays NORMAL_WORK —
//   this is not bad posture.
// - 11s-15s: an actual forward-lean drift. Ground truth is FORWARD_LEAN.
const SESSION_ENTRIES: SessionLogEntry[] = [
  neutralEntry(0, "NORMAL_WORK"),
  neutralEntry(1000, "NORMAL_WORK"),
  neutralEntry(2000, "NORMAL_WORK"),
  neutralEntry(3000, "NORMAL_WORK"),
  neutralEntry(4000, "NORMAL_WORK"),
  { ...neutralEntry(5000, "NORMAL_WORK"), features: { ...neutralEntry(5000, "NORMAL_WORK").features, yawProxy: 0.45 } },
  { ...neutralEntry(6000, "NORMAL_WORK"), features: { ...neutralEntry(6000, "NORMAL_WORK").features, yawProxy: 0.45 } },
  { ...neutralEntry(7000, "NORMAL_WORK"), features: { ...neutralEntry(7000, "NORMAL_WORK").features, yawProxy: 0.45 } },
  { ...neutralEntry(8000, "NORMAL_WORK"), features: { ...neutralEntry(8000, "NORMAL_WORK").features, yawProxy: 0.45 } },
  { ...neutralEntry(9000, "NORMAL_WORK"), features: { ...neutralEntry(9000, "NORMAL_WORK").features, yawProxy: 0.45 } },
  neutralEntry(10000, "NORMAL_WORK"),
  {
    ...neutralEntry(11000, "FORWARD_LEAN"),
    features: { ...neutralEntry(11000, "FORWARD_LEAN").features, faceToShoulderRatio: 0.23, pitchProxy: 0.19 },
  },
  {
    ...neutralEntry(12000, "FORWARD_LEAN"),
    features: { ...neutralEntry(12000, "FORWARD_LEAN").features, faceToShoulderRatio: 0.23, pitchProxy: 0.19 },
  },
  {
    ...neutralEntry(13000, "FORWARD_LEAN"),
    features: { ...neutralEntry(13000, "FORWARD_LEAN").features, faceToShoulderRatio: 0.23, pitchProxy: 0.19 },
  },
  {
    ...neutralEntry(14000, "FORWARD_LEAN"),
    features: { ...neutralEntry(14000, "FORWARD_LEAN").features, faceToShoulderRatio: 0.23, pitchProxy: 0.19 },
  },
  {
    ...neutralEntry(15000, "FORWARD_LEAN"),
    features: { ...neutralEntry(15000, "FORWARD_LEAN").features, faceToShoulderRatio: 0.23, pitchProxy: 0.19 },
  },
  neutralEntry(16000, "NORMAL_WORK"),
];

const GROUND_TRUTH: ScenarioLabel[] = [
  { timestamp: 0, label: "NORMAL_WORK" },
  { timestamp: 11000, label: "FORWARD_LEAN" },
  { timestamp: 16000, label: "NORMAL_WORK" },
];

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
