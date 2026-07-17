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

// TODO(C): fold `observation` into `context`, using motion energy / drift
// score trends to move between STABLE -> MOVING -> SETTLING ->
// DRIFT_SUSPECTED -> SUSTAINED_DRIFT -> ALERTED -> RECOVERED
// (plan.md section 13).
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
