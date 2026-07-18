import type { DetectionEvent } from "../../core/types";
import type { SessionLogEntry } from "../recorder";
import {
  DEFAULT_THRESHOLDS,
  evaluateV0,
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

// Wires B's V0 fixed-threshold detector up as a replay Detector so a stored
// session log can produce a DetectionEvent stream end-to-end (Day2 target).
export function createV0Detector(
  referenceCenters: Record<string, number>,
  thresholds: FixedThresholds = DEFAULT_THRESHOLDS,
): Detector {
  return (entry) =>
    evaluateV0(
      {
        timestamp: entry.timestamp,
        confidence: entry.confidence,
        shoulderTilt: entry.features.shoulderTilt,
        headXOffset: entry.features.headXOffset,
        headYOffset: entry.features.headYOffset,
        bodyScale: entry.features.bodyScale,
        torsoLean: entry.features.torsoLean,
        motionEnergy: entry.features.motionEnergy,
      },
      referenceCenters,
      thresholds,
    );
}
