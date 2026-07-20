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
  /** Wall-clock timestamp the current match streak (DRIFT_SUSPECTED or later) began. null when nothing is being tracked. */
  matchStreakStart: number | null;
  /** Wall-clock timestamp the current clean recovery streak (post-ALERTED, calm + no match) began. null when not recovering. */
  recoveryStreakStart: number | null;
  /** Wall-clock timestamp the current hold (low reliability, or motion while mid-streak) began. null when not held. */
  holdStart: number | null;
  /** Wall-clock timestamp of the last ALERTED transition, for cooldown. null before the first alert. */
  lastAlertedAt: number | null;
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
 *   below threshold, continuously, for recoverSec (any interruption inside
 *   this window resets the recovery timer to 0 — recovery has no slack,
 *   unlike cooldown below).
 * - Re-entering ALERTED is suppressed until cooldownSec has passed since
 *   the last ALERTED timestamp (tracked in wall-clock time, independent of
 *   holds). Dwell accumulation keeps running underneath the suppression —
 *   only the ALERTED promotion itself is held back.
 * - Frames that are UNKNOWN (low reliability) or inside the
 *   feature_discussion 0번 global motionEnergy gate HOLD the in-progress
 *   dwell timer (neither accumulate nor reset it) unless the hold itself
 *   lasts longer than holdResetSec, at which point the dwell timer resets
 *   to 0 and the state falls back to STABLE.
 */
export const ALERT_TIMING = {
  suspectToSustainSec: 2.0,
  sustainToAlertSec: 1.0,
  alertCeilingSec: 8.0,
  recoverSec: 1.5,
  cooldownSec: 8.0,
  holdResetSec: 4.0,
} as const;

if (ALERT_TIMING.suspectToSustainSec + ALERT_TIMING.sustainToAlertSec > ALERT_TIMING.alertCeilingSec) {
  throw new Error(
    "ALERT_TIMING: suspectToSustainSec + sustainToAlertSec must stay under alertCeilingSec " +
      "(need_discussion 5번's guardrail for the official 10s detection metric).",
  );
}

const MS_PER_SEC = 1000;

/**
 * Inputs this module doesn't own the values for (need_discussion 2번/3번/
 * 4번 — A/B). `driftScoreMatch` mirrors personalized-detector's current
 * DEFAULT_PERSONALIZED_THRESHOLDS.driftScore; `reliabilityFloor` mirrors
 * landmark-reliability's RELIABILITY_THRESHOLDS.minConfidence.
 * `motionEnergyGate` (need_discussion 2번, A's τ_motion) has no agreed
 * value yet — this default just keeps the module runnable and should be
 * overridden once A ships one.
 */
export interface StateMachineThresholds {
  driftScoreMatch: number;
  motionEnergyGate: number;
  reliabilityFloor: number;
}

export const DEFAULT_THRESHOLDS: StateMachineThresholds = {
  driftScoreMatch: 3,
  motionEnergyGate: 0.15,
  reliabilityFloor: 0.5,
};

export function initialContext(timestamp: number): StateMachineContext {
  return {
    state: "STABLE",
    enteredAt: timestamp,
    matchStreakStart: null,
    recoveryStreakStart: null,
    holdStart: null,
    lastAlertedAt: null,
  };
}

function enter(
  nextState: PostureState,
  timestamp: number,
  context: StateMachineContext,
): Pick<StateMachineContext, "state" | "enteredAt"> {
  return {
    state: nextState,
    enteredAt: context.state === nextState ? context.enteredAt : timestamp,
  };
}

/**
 * Advances the temporal state machine by one frame. `observation` carries
 * the drift signal (B's output); `motionEnergy` is passed separately
 * (rather than folded into DriftObservation) since it's a FrameFeature
 * value C only consumes, not part of B's drift contract.
 */
export function step(
  context: StateMachineContext,
  observation: DriftObservation,
  motionEnergy: number,
  thresholds: StateMachineThresholds = DEFAULT_THRESHOLDS,
): { context: StateMachineContext; event: DetectionEvent } {
  const { timestamp } = observation;
  // RECOVERED is a single-tick label (need_discussion 5번); fall through to
  // STABLE before evaluating this frame.
  const state = context.state === "RECOVERED" ? "STABLE" : context.state;

  const isHold = observation.reliability < thresholds.reliabilityFloor;
  const isMoving = !isHold && motionEnergy >= thresholds.motionEnergyGate;
  const isMatch = !isHold && !isMoving && observation.driftScore >= thresholds.driftScoreMatch;

  let next: StateMachineContext;

  switch (state) {
    case "STABLE":
    case "SETTLING": {
      if (isHold) {
        next = { ...context, ...enter(state, timestamp, context), holdStart: context.holdStart ?? timestamp };
      } else if (isMoving) {
        next = { ...context, ...enter("MOVING", timestamp, context), holdStart: null, matchStreakStart: null };
      } else if (isMatch) {
        const matchStreakStart = context.matchStreakStart ?? timestamp;
        next = { ...context, ...enter("DRIFT_SUSPECTED", timestamp, context), matchStreakStart, holdStart: null };
      } else {
        next = { ...context, ...enter("STABLE", timestamp, context), matchStreakStart: null, holdStart: null };
      }
      break;
    }
    case "MOVING": {
      if (isHold) {
        next = { ...context, ...enter(state, timestamp, context), holdStart: context.holdStart ?? timestamp };
      } else if (isMoving) {
        next = { ...context, ...enter("MOVING", timestamp, context), holdStart: null };
      } else {
        // Motion just stopped — one settling tick before trusting driftScore again.
        next = { ...context, ...enter("SETTLING", timestamp, context), holdStart: null };
      }
      break;
    }
    case "DRIFT_SUSPECTED":
    case "SUSTAINED_DRIFT": {
      if (isHold || isMoving) {
        const holdStart = context.holdStart ?? timestamp;
        const heldTooLong = timestamp - holdStart >= ALERT_TIMING.holdResetSec * MS_PER_SEC;
        next = heldTooLong
          ? { ...context, ...enter("STABLE", timestamp, context), matchStreakStart: null, holdStart: null }
          : { ...context, ...enter(state, timestamp, context), holdStart };
        break;
      }
      if (!isMatch) {
        next = { ...context, ...enter("STABLE", timestamp, context), matchStreakStart: null, holdStart: null };
        break;
      }
      const matchStreakStart = context.matchStreakStart ?? timestamp;
      const dwellMs = timestamp - matchStreakStart;
      const sustainAtMs = ALERT_TIMING.suspectToSustainSec * MS_PER_SEC;
      const alertAtMs = sustainAtMs + ALERT_TIMING.sustainToAlertSec * MS_PER_SEC;

      if (dwellMs >= alertAtMs) {
        const inCooldown =
          context.lastAlertedAt !== null && timestamp - context.lastAlertedAt < ALERT_TIMING.cooldownSec * MS_PER_SEC;
        next = inCooldown
          ? { ...context, ...enter("SUSTAINED_DRIFT", timestamp, context), matchStreakStart, holdStart: null }
          : {
              ...context,
              ...enter("ALERTED", timestamp, context),
              matchStreakStart,
              holdStart: null,
              recoveryStreakStart: null,
              lastAlertedAt: timestamp,
            };
        break;
      }
      const nextState: PostureState = dwellMs >= sustainAtMs ? "SUSTAINED_DRIFT" : "DRIFT_SUSPECTED";
      next = { ...context, ...enter(nextState, timestamp, context), matchStreakStart, holdStart: null };
      break;
    }
    case "ALERTED": {
      if (isHold || isMoving || isMatch) {
        // Recovery must be an uninterrupted calm + non-match streak — any
        // hold, motion, or renewed match breaks it (no slack, unlike cooldown).
        next = {
          ...context,
          ...enter("ALERTED", timestamp, context),
          holdStart: isHold ? (context.holdStart ?? timestamp) : null,
          recoveryStreakStart: null,
        };
        break;
      }
      const recoveryStreakStart = context.recoveryStreakStart ?? timestamp;
      const recoveredMs = timestamp - recoveryStreakStart;
      next =
        recoveredMs >= ALERT_TIMING.recoverSec * MS_PER_SEC
          ? {
              ...context,
              ...enter("RECOVERED", timestamp, context),
              matchStreakStart: null,
              recoveryStreakStart: null,
              holdStart: null,
            }
          : { ...context, ...enter("ALERTED", timestamp, context), recoveryStreakStart, holdStart: null };
      break;
    }
    default: {
      // SLOW_DRIFT_WATCH is reserved (need_discussion 5번 defers it to a
      // later round); not reachable from step() yet, so treat it as STABLE
      // if a caller ever seeds a context with it directly.
      next = { ...context, ...enter("STABLE", timestamp, context), matchStreakStart: null, holdStart: null };
    }
  }

  return { context: next, event: makeEvent(next, observation) };
}

const REASON_STATES: ReadonlySet<PostureState> = new Set(["DRIFT_SUSPECTED", "SUSTAINED_DRIFT", "ALERTED"]);

function makeEvent(context: StateMachineContext, observation: DriftObservation): DetectionEvent {
  return {
    timestamp: observation.timestamp,
    state: context.state,
    alert: context.state === "ALERTED",
    reason: REASON_STATES.has(context.state) ? observation.dominantFeatures : [],
  };
}
