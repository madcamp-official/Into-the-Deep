import type { DetectionEvent, ScenarioLabel } from "../../core/types";

export interface ReplayFrame {
  timestamp: number;
  groundTruth: ScenarioLabel["label"];
  cameraState: string;
  confidence: number;
  features: Record<string, number>;
}

export type Detector = (frame: ReplayFrame) => DetectionEvent;

// TODO(C): replay a parsed JSONL session through a given detector (V0/V1/V2)
// and collect the resulting DetectionEvent stream (plan.md section 19).
export function replay(frames: ReplayFrame[], detector: Detector): DetectionEvent[] {
  return frames.map(detector);
}
