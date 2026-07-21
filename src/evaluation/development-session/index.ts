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

// Trimmed to only scenarios with an active rule to test (v0/v2's
// sustainedSeconds is 1.5s at most now, v0 is instant, so each scenario only
// needs a few settle seconds + a short hold, not the original long
// pre-roll/hold pattern). Dropped entirely: SIDE_SHIFT (never implemented —
// no body-relative "moved sideways" feature exists), ROUNDED_SHOULDERS
// (rule deleted this session, no discriminating feature), CLOSE_TO_CAMERA
// (no rule targets it directly — it's a known FORWARD_LEAN contamination
// case, explicitly left out of scope). CAMERA_CHANGE is intentionally
// manual because the operator must physically move the camera or laptop
// during that scenario.
export const STANDARD_DEVELOPMENT_SESSION: readonly DevelopmentSessionStep[] = [
  { atSeconds: 0, action: "SCENARIO_STARTED", label: "NORMAL_WORK" },
  { atSeconds: 15, action: "SCENARIO_STARTED", label: "TRANSIENT_ACTION" },
  { atSeconds: 20, action: "SCENARIO_ENDED", label: "TRANSIENT_ACTION" },
  { atSeconds: 25, action: "SCENARIO_STARTED", label: "FORWARD_LEAN" },
  { atSeconds: 27, action: "DRIFT_ONSET", label: "FORWARD_LEAN" },
  { atSeconds: 35, action: "SCENARIO_ENDED", label: "FORWARD_LEAN" },
  { atSeconds: 40, action: "SCENARIO_STARTED", label: "FORWARD_HEAD" },
  { atSeconds: 42, action: "DRIFT_ONSET", label: "FORWARD_HEAD" },
  { atSeconds: 50, action: "SCENARIO_ENDED", label: "FORWARD_HEAD" },
  { atSeconds: 55, action: "SCENARIO_STARTED", label: "LEFT_LEAN" },
  { atSeconds: 57, action: "DRIFT_ONSET", label: "LEFT_LEAN" },
  { atSeconds: 65, action: "SCENARIO_ENDED", label: "LEFT_LEAN" },
  { atSeconds: 70, action: "SCENARIO_STARTED", label: "RIGHT_LEAN" },
  { atSeconds: 72, action: "DRIFT_ONSET", label: "RIGHT_LEAN" },
  { atSeconds: 80, action: "SCENARIO_ENDED", label: "RIGHT_LEAN" },
  { atSeconds: 85, action: "SCENARIO_STARTED", label: "HEAD_TURN" },
  { atSeconds: 87, action: "DRIFT_ONSET", label: "HEAD_TURN" },
  { atSeconds: 95, action: "SCENARIO_ENDED", label: "HEAD_TURN" },
  { atSeconds: 100, action: "SCENARIO_STARTED", label: "HEAD_TILT" },
  { atSeconds: 102, action: "DRIFT_ONSET", label: "HEAD_TILT" },
  { atSeconds: 110, action: "SCENARIO_ENDED", label: "HEAD_TILT" },
  { atSeconds: 115, action: "SCENARIO_STARTED", label: "CHIN_REST" },
  { atSeconds: 117, action: "DRIFT_ONSET", label: "CHIN_REST" },
  { atSeconds: 125, action: "SCENARIO_ENDED", label: "CHIN_REST" },
  { atSeconds: 130, action: "SCENARIO_STARTED", label: "HEAD_BACK" },
  { atSeconds: 132, action: "DRIFT_ONSET", label: "HEAD_BACK" },
  { atSeconds: 140, action: "SCENARIO_ENDED", label: "HEAD_BACK" },
  { atSeconds: 145, action: "SCENARIO_STARTED", label: "SHOULDER_ASYMMETRY" },
  { atSeconds: 147, action: "DRIFT_ONSET", label: "SHOULDER_ASYMMETRY" },
  { atSeconds: 155, action: "SCENARIO_ENDED", label: "SHOULDER_ASYMMETRY" },
  { atSeconds: 160, action: "SCENARIO_STARTED", label: "BACKWARD_LEAN" },
  { atSeconds: 162, action: "DRIFT_ONSET", label: "BACKWARD_LEAN" },
  { atSeconds: 170, action: "SCENARIO_ENDED", label: "BACKWARD_LEAN" },
  { atSeconds: 175, action: "SCENARIO_STARTED", label: "ARMREST_LEAN" },
  { atSeconds: 177, action: "DRIFT_ONSET", label: "ARMREST_LEAN" },
  { atSeconds: 185, action: "SCENARIO_ENDED", label: "ARMREST_LEAN" },
  { atSeconds: 190, action: "SCENARIO_STARTED", label: "TORSO_TWIST" },
  { atSeconds: 192, action: "DRIFT_ONSET", label: "TORSO_TWIST" },
  { atSeconds: 200, action: "SCENARIO_ENDED", label: "TORSO_TWIST" },
  { atSeconds: 205, action: "SCENARIO_STARTED", label: "SHOULDERS_ONLY_TWIST" },
  { atSeconds: 207, action: "DRIFT_ONSET", label: "SHOULDERS_ONLY_TWIST" },
  { atSeconds: 215, action: "SCENARIO_ENDED", label: "SHOULDERS_ONLY_TWIST" },
  { atSeconds: 220, action: "SESSION_ENDED" },
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
