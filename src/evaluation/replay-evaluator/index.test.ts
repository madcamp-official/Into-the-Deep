import { describe, expect, it } from "vitest";
import { createV0Detector, replay } from "./index";
import type { SessionLogEntry } from "../recorder";

const referenceCenters: Record<string, number> = {
  shoulderTilt: 0,
  headXOffset: 0,
  headYOffset: 0,
  bodyScale: 1,
};

describe("createV0Detector", () => {
  it("uses sustained V0 alert timing during replay", () => {
    const detector = createV0Detector(referenceCenters);
    const events = replay(
      [
        createEntry(0, 0),
        createEntry(1000, 0.19),
        createEntry(2490, 0.19),
        createEntry(2500, 0.19),
        createEntry(3000, 0),
      ],
      detector,
    );

    expect(events).toMatchObject([
      { timestamp: 0, state: "STABLE", alert: false, reason: [] },
      { timestamp: 1000, state: "BAD", alert: false, reason: ["headYOffset"] },
      { timestamp: 2490, state: "BAD", alert: false, reason: ["headYOffset"] },
      { timestamp: 2500, state: "BAD", alert: true, reason: ["headYOffset"] },
      { timestamp: 3000, state: "STABLE", alert: false, reason: [] },
    ]);
  });
});

function createEntry(timestamp: number, headYOffset: number): SessionLogEntry {
  return {
    timestamp,
    groundTruth: headYOffset > 0 ? "FORWARD_LEAN" : "NORMAL_WORK",
    cameraState: "VALID",
    confidence: 0.95,
    features: {
      shoulderTilt: 0,
      headXOffset: 0,
      headYOffset,
      bodyScale: 1,
      motionEnergy: 0.05,
    },
  };
}
