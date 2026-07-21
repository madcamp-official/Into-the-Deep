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

export const CAMERA_DEVELOPMENT_SESSION: readonly DevelopmentSessionStep[] = [
  { atSeconds: 0, action: "SCENARIO_STARTED", label: "NORMAL_WORK" },
  { atSeconds: 20, action: "SCENARIO_STARTED", label: "CAMERA_CHANGE" },
  { atSeconds: 35, action: "SCENARIO_ENDED", label: "CAMERA_CHANGE" },
  { atSeconds: 45, action: "SCENARIO_STARTED", label: "CAMERA_CHANGE" },
  { atSeconds: 60, action: "SCENARIO_ENDED", label: "CAMERA_CHANGE" },
  { atSeconds: 70, action: "SESSION_ENDED" },
];

// Only scenarios whose label matches an active postureType in
// posture-rules/index.ts, plus NORMAL_WORK as the required baseline.
// Dropped: TRANSIENT_ACTION/LEFT_LEAN/RIGHT_LEAN/SIDE_SHIFT/CLOSE_TO_CAMERA
// (no matching rule — SIDE_SHIFT and CLOSE_TO_CAMERA specifically have no
// discriminating feature at all, LEFT_LEAN/RIGHT_LEAN/TRANSIENT_ACTION are
// ScenarioLabel-only categories, not a rule's postureType) and
// ROUNDED_SHOULDERS/CHIN_TUCK (rules deleted this session). Added
// HEAD_DOWN, which has an active rule but wasn't in the script before.
export const STANDARD_DEVELOPMENT_SESSION: readonly DevelopmentSessionStep[] = [
  { atSeconds: 0, action: "SCENARIO_STARTED", label: "NORMAL_WORK" },
  { atSeconds: 15, action: "SCENARIO_STARTED", label: "FORWARD_HEAD" },
  { atSeconds: 17, action: "DRIFT_ONSET", label: "FORWARD_HEAD" },
  { atSeconds: 25, action: "SCENARIO_ENDED", label: "FORWARD_HEAD" },
  { atSeconds: 30, action: "SCENARIO_STARTED", label: "HEAD_DOWN" },
  { atSeconds: 32, action: "DRIFT_ONSET", label: "HEAD_DOWN" },
  { atSeconds: 40, action: "SCENARIO_ENDED", label: "HEAD_DOWN" },
  { atSeconds: 45, action: "SCENARIO_STARTED", label: "FORWARD_LEAN" },
  { atSeconds: 47, action: "DRIFT_ONSET", label: "FORWARD_LEAN" },
  { atSeconds: 55, action: "SCENARIO_ENDED", label: "FORWARD_LEAN" },
  { atSeconds: 60, action: "SCENARIO_STARTED", label: "BACKWARD_LEAN" },
  { atSeconds: 62, action: "DRIFT_ONSET", label: "BACKWARD_LEAN" },
  { atSeconds: 70, action: "SCENARIO_ENDED", label: "BACKWARD_LEAN" },
  { atSeconds: 75, action: "SCENARIO_STARTED", label: "HEAD_TURN" },
  { atSeconds: 77, action: "DRIFT_ONSET", label: "HEAD_TURN" },
  { atSeconds: 85, action: "SCENARIO_ENDED", label: "HEAD_TURN" },
  { atSeconds: 90, action: "SCENARIO_STARTED", label: "HEAD_TILT" },
  { atSeconds: 92, action: "DRIFT_ONSET", label: "HEAD_TILT" },
  { atSeconds: 100, action: "SCENARIO_ENDED", label: "HEAD_TILT" },
  { atSeconds: 105, action: "SCENARIO_STARTED", label: "CHIN_REST" },
  { atSeconds: 107, action: "DRIFT_ONSET", label: "CHIN_REST" },
  { atSeconds: 115, action: "SCENARIO_ENDED", label: "CHIN_REST" },
  { atSeconds: 120, action: "SCENARIO_STARTED", label: "HEAD_BACK" },
  { atSeconds: 122, action: "DRIFT_ONSET", label: "HEAD_BACK" },
  { atSeconds: 130, action: "SCENARIO_ENDED", label: "HEAD_BACK" },
  { atSeconds: 135, action: "SCENARIO_STARTED", label: "SHOULDER_ASYMMETRY" },
  { atSeconds: 137, action: "DRIFT_ONSET", label: "SHOULDER_ASYMMETRY" },
  { atSeconds: 145, action: "SCENARIO_ENDED", label: "SHOULDER_ASYMMETRY" },
  { atSeconds: 150, action: "SCENARIO_STARTED", label: "ARMREST_LEAN" },
  { atSeconds: 152, action: "DRIFT_ONSET", label: "ARMREST_LEAN" },
  { atSeconds: 160, action: "SCENARIO_ENDED", label: "ARMREST_LEAN" },
  { atSeconds: 165, action: "SCENARIO_STARTED", label: "TORSO_TWIST" },
  { atSeconds: 167, action: "DRIFT_ONSET", label: "TORSO_TWIST" },
  { atSeconds: 175, action: "SCENARIO_ENDED", label: "TORSO_TWIST" },
  { atSeconds: 180, action: "SCENARIO_STARTED", label: "SHOULDERS_ONLY_TWIST" },
  { atSeconds: 182, action: "DRIFT_ONSET", label: "SHOULDERS_ONLY_TWIST" },
  { atSeconds: 190, action: "SCENARIO_ENDED", label: "SHOULDERS_ONLY_TWIST" },
  { atSeconds: 195, action: "SESSION_ENDED" },
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
