import type { DriftObservation, DetectionEvent } from "../types";

export type PostureState =
  | "STABLE"
  | "MOVING"
  | "SETTLING"
  | "SLOW_DRIFT_WATCH"
  | "DRIFT_SUSPECTED"
  | "SUSTAINED_DRIFT"
  | "ALERTED"
  | "RECOVERED";

export interface StateMachineContext {
  state: PostureState;
  enteredAt: number;
}

/**
 * Timing decisions from need_discussion 5번 (C가 결정). All durations are
 * in seconds of wall-clock dwell time, not frame counts, so behavior is
 * stable across frame-rate variance.
 *
 * - DRIFT_SUSPECTED -> SUSTAINED_DRIFT once a rule match dwells for
 *   suspectToSustainSec.
 * - SUSTAINED_DRIFT -> ALERTED once the same rule match dwells for a
 *   further sustainToAlertSec (alertCeilingSec is the hard upper bound so
 *   the official "detected within 10s" metric always has margin).
 * - ALERTED -> RECOVERED once the rule stops matching AND motionEnergy is
 *   below threshold, continuously, for recoverSec (any re-match inside
 *   this window resets the recovery timer to 0 — recovery has no slack,
 *   unlike cooldown below).
 * - Re-entering ALERTED for the same postureType is suppressed until
 *   cooldownSec has passed since the last ALERTED timestamp (tracked in
 *   wall-clock time, independent of holds).
 * - Frames that are UNKNOWN, have cameraState RECALIBRATION_REQUIRED, or
 *   are inside the feature_discussion 0번 global motionEnergy gate HOLD
 *   the in-progress dwell timer (neither accumulate nor reset it) unless
 *   the hold itself lasts longer than holdResetSec, at which point the
 *   dwell timer resets to 0.
 */
export const ALERT_TIMING = {
  suspectToSustainSec: 2.0,
  sustainToAlertSec: 1.0,
  alertCeilingSec: 8.0,
  recoverSec: 1.5,
  cooldownSec: 8.0,
  holdResetSec: 4.0,
} as const;

// TODO(C): fold `observation` into `context`, using motion energy / drift
// score trends and ALERT_TIMING above to move between STABLE -> MOVING ->
// SETTLING -> DRIFT_SUSPECTED -> SUSTAINED_DRIFT -> ALERTED -> RECOVERED
// (plan.md section 13). Blocked on need_discussion 3번 (자세별 rule 조건,
// B/A) and 4번 (MAD 정책, B) landing first, since this needs a real
// rule-match signal (postureType + matched) instead of the old
// DriftObservation.driftScore shape.
export function step(
  context: StateMachineContext,
  observation: DriftObservation,
): { context: StateMachineContext; event: DetectionEvent } {
  void observation;
  return {
    context,
    event: {
      timestamp: observation.timestamp,
      state: context.state,
      alert: false,
      reason: [],
    },
  };
}

export function initialContext(timestamp: number): StateMachineContext {
  return { state: "STABLE", enteredAt: timestamp };
}
