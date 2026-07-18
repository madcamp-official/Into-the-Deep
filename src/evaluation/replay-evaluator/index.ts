import type { DetectionEvent } from "../../core/types";
import type { SessionLogEntry } from "../recorder";
import {
  DEFAULT_THRESHOLDS,
  FixedThresholdDetector,
  type FixedThresholds,
} from "../../core/fixed-threshold-detector";

export type Detector = (entry: SessionLogEntry) => DetectionEvent;

// Replays a parsed JSONL session through a given detector (V0/V1/V2) and
// collects the resulting DetectionEvent stream (plan.md section 19).
export function replay(
  entries: readonly SessionLogEntry[],
  detector: Detector,
): DetectionEvent[] {
  return entries.map(detector);
}

// Wires B's sustained V0 fixed-threshold detector into replay so stored
// JSONL logs follow the same alert timing as the live app.
export function createV0Detector(
  referenceCenters: Record<string, number>,
  thresholds: FixedThresholds = DEFAULT_THRESHOLDS,
): Detector {
  const detector = new FixedThresholdDetector(referenceCenters, thresholds);

  return (entry) =>
    detector.update({
      timestamp: entry.timestamp,
      confidence: entry.confidence,
      shoulderTilt: entry.features.shoulderTilt,
      headXOffset: entry.features.headXOffset,
      shoulderXOffset: entry.features.shoulderXOffset,
      shoulderYOffset: entry.features.shoulderYOffset,
      bodyScale: entry.features.bodyScale,
      torsoLean: entry.features.torsoLean,
      motionEnergy: entry.features.motionEnergy,
    });
}
