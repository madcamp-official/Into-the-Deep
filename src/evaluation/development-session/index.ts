import type { ScenarioLabel } from "../../core/types";

export type DevelopmentSessionAction =
  | "SCENARIO_STARTED"
  | "DRIFT_ONSET"
  | "SCENARIO_ENDED"
  | "SESSION_ENDED";

export interface DevelopmentSessionStep {
  atSeconds: number;
  action: DevelopmentSessionAction;
  label?: ScenarioLabel["label"];
}

// The preset leaves enough time for the subject to settle before each drift.
// CAMERA_CHANGE is intentionally manual because the operator must physically
// move the camera or laptop during that scenario.
export const STANDARD_DEVELOPMENT_SESSION: readonly DevelopmentSessionStep[] = [
  { atSeconds: 0, action: "SCENARIO_STARTED", label: "NORMAL_WORK" },
  { atSeconds: 20, action: "SCENARIO_STARTED", label: "TRANSIENT_ACTION" },
  { atSeconds: 25, action: "SCENARIO_ENDED", label: "TRANSIENT_ACTION" },
  { atSeconds: 35, action: "SCENARIO_STARTED", label: "FORWARD_LEAN" },
  { atSeconds: 40, action: "DRIFT_ONSET", label: "FORWARD_LEAN" },
  { atSeconds: 52, action: "SCENARIO_ENDED", label: "FORWARD_LEAN" },
  { atSeconds: 62, action: "SCENARIO_STARTED", label: "FORWARD_HEAD" },
  { atSeconds: 67, action: "DRIFT_ONSET", label: "FORWARD_HEAD" },
  { atSeconds: 79, action: "SCENARIO_ENDED", label: "FORWARD_HEAD" },
  { atSeconds: 89, action: "SCENARIO_STARTED", label: "LEFT_LEAN" },
  { atSeconds: 94, action: "DRIFT_ONSET", label: "LEFT_LEAN" },
  { atSeconds: 106, action: "SCENARIO_ENDED", label: "LEFT_LEAN" },
  { atSeconds: 116, action: "SCENARIO_STARTED", label: "RIGHT_LEAN" },
  { atSeconds: 121, action: "DRIFT_ONSET", label: "RIGHT_LEAN" },
  { atSeconds: 133, action: "SCENARIO_ENDED", label: "RIGHT_LEAN" },
  { atSeconds: 143, action: "SCENARIO_STARTED", label: "SIDE_SHIFT" },
  { atSeconds: 148, action: "DRIFT_ONSET", label: "SIDE_SHIFT" },
  { atSeconds: 160, action: "SCENARIO_ENDED", label: "SIDE_SHIFT" },
  { atSeconds: 170, action: "SCENARIO_STARTED", label: "HEAD_TURN" },
  { atSeconds: 175, action: "DRIFT_ONSET", label: "HEAD_TURN" },
  { atSeconds: 187, action: "SCENARIO_ENDED", label: "HEAD_TURN" },
  { atSeconds: 197, action: "SCENARIO_STARTED", label: "CLOSE_TO_CAMERA" },
  { atSeconds: 202, action: "DRIFT_ONSET", label: "CLOSE_TO_CAMERA" },
  { atSeconds: 214, action: "SCENARIO_ENDED", label: "CLOSE_TO_CAMERA" },
  { atSeconds: 224, action: "SESSION_ENDED" },
];

export function getNextDevelopmentStep(
  steps: readonly DevelopmentSessionStep[],
  currentIndex: number,
  elapsedSeconds: number,
): { step: DevelopmentSessionStep; index: number } | null {
  const nextIndex = currentIndex + 1;
  const step = steps[nextIndex];
  if (!step || step.atSeconds > elapsedSeconds) return null;
  return { step, index: nextIndex };
}
