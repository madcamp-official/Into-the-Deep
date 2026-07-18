import type { DetectionEvent, FrameFeature, UserProfile } from "../../core/types";
import type { SessionLogEntry } from "../recorder";
import {
  DEFAULT_THRESHOLDS,
  FixedThresholdDetector,
  type FixedThresholds,
} from "../../core/fixed-threshold-detector";
import {
  DEFAULT_PERSONALIZED_THRESHOLDS,
  PersonalizedDriftDetector,
  type PersonalizedThresholds,
} from "../../core/personalized-detector";

export type Detector = (entry: SessionLogEntry) => DetectionEvent;

// Replays a parsed JSONL session through a given detector (V0/V1/V2) and
// collects the resulting DetectionEvent stream (plan.md section 19).
export function replay(
  entries: readonly SessionLogEntry[],
  detector: Detector,
): DetectionEvent[] {
  return entries.map(detector);
}

function toFrameFeature(entry: SessionLogEntry): FrameFeature {
  return {
    timestamp: entry.timestamp,
    confidence: entry.confidence,
    shoulderTilt: entry.features.shoulderTilt,
    headXOffset: entry.features.headXOffset,
    shoulderXOffset: entry.features.shoulderXOffset,
    shoulderYOffset: entry.features.shoulderYOffset,
    bodyScale: entry.features.bodyScale,
    faceToShoulderRatio: entry.features.faceToShoulderRatio,
    pitchProxy: entry.features.pitchProxy,
    yawProxy: entry.features.yawProxy,
    motionEnergy: entry.features.motionEnergy,
  };
}

// Wires B's sustained V0 fixed-threshold detector into replay so stored
// JSONL logs follow the same alert timing as the live app.
export function createV0Detector(
  referenceCenters: Record<string, number>,
  thresholds: FixedThresholds = DEFAULT_THRESHOLDS,
): Detector {
  const detector = new FixedThresholdDetector(referenceCenters, thresholds);

  return (entry) => detector.update(toFrameFeature(entry));
}

// Wires B's personalized V1 drift detector into replay, so a stored JSONL
// session can be compared against V0 on the exact same frames (Day3 target,
// plan.md section 23: "저장된 로그에서 V0/V1 비교 가능").
export function createV1Detector(
  profile: UserProfile,
  thresholds: PersonalizedThresholds = DEFAULT_PERSONALIZED_THRESHOLDS,
): Detector {
  const detector = new PersonalizedDriftDetector(profile, thresholds);

  return (entry) => detector.update(toFrameFeature(entry)).event;
}
