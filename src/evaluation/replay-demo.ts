import { parseJSONL, type SessionLogEntry } from "./recorder";
import { createV0Detector, replay } from "./replay-evaluator";
import { computeMetrics, type MetricsReport } from "./metrics";
import type { DetectionEvent, ScenarioLabel } from "../core/types";

// Mirrors sample-data/sample-session.jsonl. Kept inline (rather than read
// from disk) since this module also needs to run in the browser; update
// both together until a shared asset loader exists.
const SAMPLE_SESSION_JSONL = [
  '{"timestamp":0,"groundTruth":"NORMAL_WORK","cameraState":"VALID","confidence":0.96,"features":{"shoulderTilt":1.4,"headXOffset":0.02,"headYOffset":0.01,"bodyScale":1.00,"motionEnergy":0.05}}',
  '{"timestamp":1000,"groundTruth":"NORMAL_WORK","cameraState":"VALID","confidence":0.95,"features":{"shoulderTilt":1.6,"headXOffset":0.03,"headYOffset":0.02,"bodyScale":1.01,"motionEnergy":0.06}}',
  '{"timestamp":31420,"groundTruth":"NORMAL_WORK","cameraState":"VALID","confidence":0.94,"features":{"shoulderTilt":2.1,"headXOffset":0.06,"headYOffset":0.93,"bodyScale":1.04,"motionEnergy":0.12}}',
  '{"timestamp":45000,"groundTruth":"FORWARD_LEAN","cameraState":"VALID","confidence":0.93,"features":{"shoulderTilt":3.2,"headXOffset":0.05,"headYOffset":0.30,"bodyScale":1.10,"motionEnergy":0.08}}',
  '{"timestamp":60000,"groundTruth":"NORMAL_WORK","cameraState":"VALID","confidence":0.95,"features":{"shoulderTilt":1.5,"headXOffset":0.02,"headYOffset":0.01,"bodyScale":1.00,"motionEnergy":0.04}}',
].join("\n");

const SAMPLE_REFERENCE_CENTERS: Record<string, number> = {
  shoulderTilt: 1.5,
  headXOffset: 0.02,
  headYOffset: 0.01,
  bodyScale: 1.0,
};

export interface ReplayDemoResult {
  entries: SessionLogEntry[];
  events: DetectionEvent[];
  metrics: MetricsReport;
}

// Day2 completion check (plan.md section 2 schedule): stored log -> V0
// replay -> alert timestamps -> metrics, without a live camera.
export function runReplayDemo(): ReplayDemoResult {
  const entries = parseJSONL(SAMPLE_SESSION_JSONL);
  const detector = createV0Detector(SAMPLE_REFERENCE_CENTERS);
  const events = replay(entries, detector);

  const groundTruth: ScenarioLabel[] = entries.map((entry) => ({
    timestamp: entry.timestamp,
    label: entry.groundTruth,
  }));
  const metrics = computeMetrics(events, groundTruth);

  return { entries, events, metrics };
}
