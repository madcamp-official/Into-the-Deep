import { describe, expect, it } from "vitest";
import { ALERT_TIMING, DEFAULT_THRESHOLDS, initialContext, step } from "./index";
import type { DriftObservation } from "../types";

const CALM = DEFAULT_THRESHOLDS.motionEnergyGate / 2;
const MOVING = DEFAULT_THRESHOLDS.motionEnergyGate * 2;
const RELIABLE = 0.9;
const UNRELIABLE = DEFAULT_THRESHOLDS.reliabilityFloor / 2;
const MATCH_SCORE = DEFAULT_THRESHOLDS.driftScoreMatch + 1;
const CLEAR_SCORE = 0;

function observe(timestamp: number, driftScore: number, reliability = RELIABLE): DriftObservation {
  return { timestamp, driftScore, reliability, dominantFeatures: ["shoulderTilt"] };
}

describe("temporal state machine", () => {
  it("stays STABLE while calm and clear", () => {
    const { event } = step(initialContext(0), observe(1000, CLEAR_SCORE), CALM);
    expect(event).toMatchObject({ state: "STABLE", alert: false });
  });

  it("goes STABLE -> MOVING -> SETTLING -> STABLE for a brief motion burst that never matches (물 마시기 등)", () => {
    let ctx = initialContext(0);

    ctx = step(ctx, observe(500, CLEAR_SCORE), MOVING).context;
    expect(ctx.state).toBe("MOVING");

    ctx = step(ctx, observe(1000, CLEAR_SCORE), CALM).context;
    expect(ctx.state).toBe("SETTLING");

    ctx = step(ctx, observe(1500, CLEAR_SCORE), CALM).context;
    expect(ctx.state).toBe("STABLE");
  });

  it("does not alert on a transient match shorter than suspectToSustainSec", () => {
    let ctx = initialContext(0);
    const start = 0;

    ctx = step(ctx, observe(start, MATCH_SCORE), CALM).context;
    expect(ctx.state).toBe("DRIFT_SUSPECTED");

    // matches for 1s (< suspectToSustainSec = 2s), then clears
    ctx = step(ctx, observe(start + 1000, MATCH_SCORE), CALM).context;
    expect(ctx.state).toBe("DRIFT_SUSPECTED");

    const { event } = step(ctx, observe(start + 1500, CLEAR_SCORE), CALM);
    expect(event).toMatchObject({ state: "STABLE", alert: false });
  });

  it("escalates DRIFT_SUSPECTED -> SUSTAINED_DRIFT -> ALERTED once a rule match dwells past both thresholds", () => {
    let ctx = initialContext(0);
    const start = 0;

    ctx = step(ctx, observe(start, MATCH_SCORE), CALM).context;
    expect(ctx.state).toBe("DRIFT_SUSPECTED");

    const sustainAt = start + ALERT_TIMING.suspectToSustainSec * 1000;
    ctx = step(ctx, observe(sustainAt, MATCH_SCORE), CALM).context;
    expect(ctx.state).toBe("SUSTAINED_DRIFT");

    const justBeforeAlert = sustainAt + ALERT_TIMING.sustainToAlertSec * 1000 - 1;
    ctx = step(ctx, observe(justBeforeAlert, MATCH_SCORE), CALM).context;
    expect(ctx.state).toBe("SUSTAINED_DRIFT");

    const alertAt = sustainAt + ALERT_TIMING.sustainToAlertSec * 1000;
    const { event } = step(ctx, observe(alertAt, MATCH_SCORE), CALM);
    expect(event).toMatchObject({ state: "ALERTED", alert: true, reason: ["shoulderTilt"] });
  });

  it("holds (does not reset) a short reliability gap mid-streak, then resumes accumulating", () => {
    let ctx = initialContext(0);
    const start = 0;

    ctx = step(ctx, observe(start, MATCH_SCORE), CALM).context;
    expect(ctx.state).toBe("DRIFT_SUSPECTED");

    // a 1s unreliable gap, well under holdResetSec
    ctx = step(ctx, observe(start + 500, MATCH_SCORE, UNRELIABLE), CALM).context;
    expect(ctx.state).toBe("DRIFT_SUSPECTED");
    ctx = step(ctx, observe(start + 1000, MATCH_SCORE, UNRELIABLE), CALM).context;
    expect(ctx.state).toBe("DRIFT_SUSPECTED");

    // reliability returns; the original streak (started at `start`) should
    // still be the one being measured, so it crosses suspectToSustainSec
    // at `start + 2000`, not 2000ms after the gap ended.
    const sustainAt = start + ALERT_TIMING.suspectToSustainSec * 1000;
    const { context } = step(ctx, observe(sustainAt, MATCH_SCORE), CALM);
    expect(context.state).toBe("SUSTAINED_DRIFT");
  });

  it("resets the streak back to STABLE when a hold lasts longer than holdResetSec", () => {
    let ctx = initialContext(0);
    const start = 0;

    ctx = step(ctx, observe(start, MATCH_SCORE), CALM).context;
    expect(ctx.state).toBe("DRIFT_SUSPECTED");

    // holdStart is only established once the first unreliable frame arrives,
    // so the gap has to be walked frame-by-frame (like real ~33ms ticks)
    // for its accumulated duration to actually cross holdResetSec.
    const holdBegins = start + 100;
    ctx = step(ctx, observe(holdBegins, MATCH_SCORE, UNRELIABLE), CALM).context;
    expect(ctx.state).toBe("DRIFT_SUSPECTED");
    expect(ctx.holdStart).toBe(holdBegins);

    const stillWithinReset = holdBegins + ALERT_TIMING.holdResetSec * 1000 - 1;
    ctx = step(ctx, observe(stillWithinReset, MATCH_SCORE, UNRELIABLE), CALM).context;
    expect(ctx.state).toBe("DRIFT_SUSPECTED");

    const pastReset = holdBegins + ALERT_TIMING.holdResetSec * 1000;
    const { context, event } = step(ctx, observe(pastReset, MATCH_SCORE, UNRELIABLE), CALM);
    expect(context.matchStreakStart).toBeNull();
    expect(event.state).toBe("STABLE");
  });

  it("goes ALERTED -> RECOVERED only after an uninterrupted calm+clear streak of recoverSec", () => {
    let ctx = initialContext(0);
    const start = 0;

    ctx = step(ctx, observe(start, MATCH_SCORE), CALM).context;
    const sustainAt = start + ALERT_TIMING.suspectToSustainSec * 1000;
    ctx = step(ctx, observe(sustainAt, MATCH_SCORE), CALM).context;
    const alertAt = sustainAt + ALERT_TIMING.sustainToAlertSec * 1000;
    ctx = step(ctx, observe(alertAt, MATCH_SCORE), CALM).context;
    expect(ctx.state).toBe("ALERTED");

    // clears (recovery streak starts here), but a renewed match interrupts it
    const firstClear = alertAt + 500;
    ctx = step(ctx, observe(firstClear, CLEAR_SCORE), CALM).context;
    expect(ctx.state).toBe("ALERTED");
    expect(ctx.recoveryStreakStart).toBe(firstClear);

    ctx = step(ctx, observe(firstClear + 500, MATCH_SCORE), CALM).context; // interrupts recovery
    expect(ctx.state).toBe("ALERTED");
    expect(ctx.recoveryStreakStart).toBeNull();

    // recovery streak restarts from the next calm+clear frame
    const recoverStart = firstClear + 1000;
    ctx = step(ctx, observe(recoverStart, CLEAR_SCORE), CALM).context;
    expect(ctx.recoveryStreakStart).toBe(recoverStart);

    const stillRecovering = recoverStart + ALERT_TIMING.recoverSec * 1000 - 1;
    ctx = step(ctx, observe(stillRecovering, CLEAR_SCORE), CALM).context;
    expect(ctx.state).toBe("ALERTED"); // still under recoverSec since the reset

    const recoveredAt = recoverStart + ALERT_TIMING.recoverSec * 1000;
    const { event, context } = step(ctx, observe(recoveredAt, CLEAR_SCORE), CALM);
    expect(event.state).toBe("RECOVERED");
    expect(event.alert).toBe(false);

    // RECOVERED is single-tick and falls through to STABLE on the next frame
    const after = step(context, observe(recoveredAt + 16, CLEAR_SCORE), CALM);
    expect(after.event.state).toBe("STABLE");
  });

  it("suppresses re-ALERTED within cooldownSec of the last alert, but keeps accumulating underneath", () => {
    let ctx = initialContext(0);
    const start = 0;

    ctx = step(ctx, observe(start, MATCH_SCORE), CALM).context;
    const sustainAt = start + ALERT_TIMING.suspectToSustainSec * 1000;
    ctx = step(ctx, observe(sustainAt, MATCH_SCORE), CALM).context;
    const firstAlertAt = sustainAt + ALERT_TIMING.sustainToAlertSec * 1000;
    ctx = step(ctx, observe(firstAlertAt, MATCH_SCORE), CALM).context;
    expect(ctx.state).toBe("ALERTED");
    expect(ctx.lastAlertedAt).toBe(firstAlertAt);

    // recovery streak has to start on its own frame before it can complete
    const recoveryBegins = firstAlertAt + 16;
    ctx = step(ctx, observe(recoveryBegins, CLEAR_SCORE), CALM).context;
    expect(ctx.state).toBe("ALERTED");

    const recoveredAt = recoveryBegins + ALERT_TIMING.recoverSec * 1000;
    ctx = step(ctx, observe(recoveredAt, CLEAR_SCORE), CALM).context;
    expect(ctx.state).toBe("RECOVERED");

    const relapseStart = recoveredAt + 16;
    ctx = step(ctx, observe(relapseStart, MATCH_SCORE), CALM).context; // falls through RECOVERED->STABLE, then matches
    expect(ctx.state).toBe("DRIFT_SUSPECTED");

    const relapseSustainAt = relapseStart + ALERT_TIMING.suspectToSustainSec * 1000;
    ctx = step(ctx, observe(relapseSustainAt, MATCH_SCORE), CALM).context;
    const relapseAlertAt = relapseSustainAt + ALERT_TIMING.sustainToAlertSec * 1000;
    // still within cooldownSec of firstAlertAt, so this must NOT re-alert
    expect(relapseAlertAt - firstAlertAt).toBeLessThan(ALERT_TIMING.cooldownSec * 1000);
    const { event } = step(ctx, observe(relapseAlertAt, MATCH_SCORE), CALM);
    expect(event).toMatchObject({ state: "SUSTAINED_DRIFT", alert: false });
  });

  it("does not carry UNKNOWN (low reliability) frames into the alert dwell timer", () => {
    let ctx = initialContext(0);
    // several unreliable frames with a high driftScore should never promote past STABLE
    for (let t = 0; t < 6000; t += 1000) {
      ctx = step(ctx, observe(t, MATCH_SCORE, UNRELIABLE), CALM).context;
    }
    expect(ctx.state).toBe("STABLE");
  });
});
