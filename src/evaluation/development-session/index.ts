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
// ROUNDED_SHOULDERS/CHIN_TUCK/SHOULDERS_ONLY_TWIST (rules deleted — the
// latter two were dead code, their required feature was never computed).
// Added HEAD_DOWN, which has an active rule but wasn't in the script before.
// HEAD_TURN's own steps below are commented out (not removed) — its rule
// is temporarily disabled in posture-rules/index.ts, decided to drop it
// for now rather than delete it.
//
// Gap between scenarios widened 5s -> 10s and hold widened 8s -> 10s: a
// replay of a real recording with the 5s/8s version showed a suspiciously
// high NORMAL_WORK false-alert rate and near-zero accuracy on a few
// postures — plausibly because 5s wasn't enough to fully settle out of the
// previous posture before the next one started, and 8s wasn't enough
// margin for v2's 1.5s sustained-match requirement on postures that take a
// few seconds to settle into. Widening isolates whether those were real
// bugs or just this timing artifact before any threshold gets retuned.
export const STANDARD_DEVELOPMENT_SESSION: readonly DevelopmentSessionStep[] = [
  { atSeconds: 0, action: "SCENARIO_STARTED", label: "NORMAL_WORK" },
  { atSeconds: 20, action: "SCENARIO_STARTED", label: "FORWARD_HEAD" },
  { atSeconds: 23, action: "DRIFT_ONSET", label: "FORWARD_HEAD" },
  { atSeconds: 33, action: "SCENARIO_ENDED", label: "FORWARD_HEAD" },
  { atSeconds: 43, action: "SCENARIO_STARTED", label: "HEAD_DOWN" },
  { atSeconds: 46, action: "DRIFT_ONSET", label: "HEAD_DOWN" },
  { atSeconds: 56, action: "SCENARIO_ENDED", label: "HEAD_DOWN" },
  { atSeconds: 66, action: "SCENARIO_STARTED", label: "FORWARD_LEAN" },
  { atSeconds: 69, action: "DRIFT_ONSET", label: "FORWARD_LEAN" },
  { atSeconds: 79, action: "SCENARIO_ENDED", label: "FORWARD_LEAN" },
  { atSeconds: 89, action: "SCENARIO_STARTED", label: "BACKWARD_LEAN" },
  { atSeconds: 92, action: "DRIFT_ONSET", label: "BACKWARD_LEAN" },
  { atSeconds: 102, action: "SCENARIO_ENDED", label: "BACKWARD_LEAN" },
  // HEAD_TURN disabled for now (decided to drop it, not delete it):
  // { atSeconds: 112, action: "SCENARIO_STARTED", label: "HEAD_TURN" },
  // { atSeconds: 115, action: "DRIFT_ONSET", label: "HEAD_TURN" },
  // { atSeconds: 125, action: "SCENARIO_ENDED", label: "HEAD_TURN" },
  { atSeconds: 135, action: "SCENARIO_STARTED", label: "HEAD_TILT" },
  { atSeconds: 138, action: "DRIFT_ONSET", label: "HEAD_TILT" },
  { atSeconds: 148, action: "SCENARIO_ENDED", label: "HEAD_TILT" },
  { atSeconds: 158, action: "SCENARIO_STARTED", label: "CHIN_REST" },
  { atSeconds: 161, action: "DRIFT_ONSET", label: "CHIN_REST" },
  { atSeconds: 171, action: "SCENARIO_ENDED", label: "CHIN_REST" },
  { atSeconds: 181, action: "SCENARIO_STARTED", label: "HEAD_BACK" },
  { atSeconds: 184, action: "DRIFT_ONSET", label: "HEAD_BACK" },
  { atSeconds: 194, action: "SCENARIO_ENDED", label: "HEAD_BACK" },
  { atSeconds: 204, action: "SCENARIO_STARTED", label: "SHOULDER_ASYMMETRY" },
  { atSeconds: 207, action: "DRIFT_ONSET", label: "SHOULDER_ASYMMETRY" },
  { atSeconds: 217, action: "SCENARIO_ENDED", label: "SHOULDER_ASYMMETRY" },
  { atSeconds: 227, action: "SCENARIO_STARTED", label: "ARMREST_LEAN" },
  { atSeconds: 230, action: "DRIFT_ONSET", label: "ARMREST_LEAN" },
  { atSeconds: 240, action: "SCENARIO_ENDED", label: "ARMREST_LEAN" },
  { atSeconds: 250, action: "SCENARIO_STARTED", label: "TORSO_TWIST" },
  { atSeconds: 253, action: "DRIFT_ONSET", label: "TORSO_TWIST" },
  { atSeconds: 263, action: "SCENARIO_ENDED", label: "TORSO_TWIST" },
  { atSeconds: 273, action: "SESSION_ENDED" },
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
