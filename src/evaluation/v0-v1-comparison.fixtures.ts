import type { FrameFeature, ScenarioLabel } from "../core/types";
import type { SessionLogEntry } from "./recorder";

// Calibration done once, facing forward, before the session below —
// mirrors an in-app Calibration click. Every calibration frame is
// identical, so each feature's MAD is 0 and PersonalizedThresholds'
// `minimumDeviations` floor becomes the sole normalizer in V1 — this makes
// the resulting driftScore easy to compute by hand for fixture design.
export const CALIBRATION_FRAMES: FrameFeature[] = [0, 1000, 2000, 3000, 4000].map((timestamp) => ({
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
// - 5s-9s: turning to talk to a neighbor (yawProxy shifted to
//   `glanceYawProxy`). Ground truth stays NORMAL_WORK — this is not bad
//   posture.
// - 11s-15s: an actual forward-lean drift (faceToShoulderRatio/pitchProxy
//   shifted). Ground truth is FORWARD_LEAN.
//
// `glanceYawProxy` controls how far the sideways glance pushes V1's
// driftScore, so callers needing a threshold near the decision boundary
// (e.g. the threshold-sweep test) can use a smaller value than the default
// "obviously still a problem" fixture used by the V0/V1 comparison test.
export function buildGlanceAndForwardLeanSession(glanceYawProxy = 0.45): {
  entries: SessionLogEntry[];
  groundTruth: ScenarioLabel[];
} {
  const entries: SessionLogEntry[] = [
    neutralEntry(0, "NORMAL_WORK"),
    neutralEntry(1000, "NORMAL_WORK"),
    neutralEntry(2000, "NORMAL_WORK"),
    neutralEntry(3000, "NORMAL_WORK"),
    neutralEntry(4000, "NORMAL_WORK"),
    { ...neutralEntry(5000, "NORMAL_WORK"), features: { ...neutralEntry(5000, "NORMAL_WORK").features, yawProxy: glanceYawProxy } },
    { ...neutralEntry(6000, "NORMAL_WORK"), features: { ...neutralEntry(6000, "NORMAL_WORK").features, yawProxy: glanceYawProxy } },
    { ...neutralEntry(7000, "NORMAL_WORK"), features: { ...neutralEntry(7000, "NORMAL_WORK").features, yawProxy: glanceYawProxy } },
    { ...neutralEntry(8000, "NORMAL_WORK"), features: { ...neutralEntry(8000, "NORMAL_WORK").features, yawProxy: glanceYawProxy } },
    { ...neutralEntry(9000, "NORMAL_WORK"), features: { ...neutralEntry(9000, "NORMAL_WORK").features, yawProxy: glanceYawProxy } },
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

  const groundTruth: ScenarioLabel[] = [
    { timestamp: 0, label: "NORMAL_WORK" },
    { timestamp: 11000, label: "FORWARD_LEAN" },
    { timestamp: 16000, label: "NORMAL_WORK" },
  ];

  return { entries, groundTruth };
}

const DEFAULT_SESSION = buildGlanceAndForwardLeanSession();
export const SESSION_ENTRIES = DEFAULT_SESSION.entries;
export const GROUND_TRUTH = DEFAULT_SESSION.groundTruth;
