import { describe, expect, it } from "vitest";
import { createV0Detector, replay } from "./index";
import type { SessionLogEntry } from "../recorder";

const referenceCenters: Record<string, number> = {
  shoulderTilt: 0,
  headXOffset: 0,
  shoulderXOffset: 0.5,
  shoulderYOffset: 0.4,
  bodyScale: 1,
  faceToShoulderRatio: 0.28,
  pitchProxy: 0.2,
};

describe("createV0Detector", () => {
  it("uses sustained V0 alert timing during replay", () => {
    const detector = createV0Detector(referenceCenters);
    const events = replay(
      [
        createEntry(0, 0),
        createEntry(1000, 9),
        createEntry(2490, 9),
        createEntry(2500, 9),
        createEntry(3000, 0),
      ],
      detector,
    );

    expect(events).toMatchObject([
      { timestamp: 0, state: "STABLE", alert: false, reason: [] },
      { timestamp: 1000, state: "BAD", alert: false, reason: ["shoulderTilt"] },
      { timestamp: 2490, state: "BAD", alert: false, reason: ["shoulderTilt"] },
      { timestamp: 2500, state: "BAD", alert: true, reason: ["shoulderTilt"] },
      { timestamp: 3000, state: "STABLE", alert: false, reason: [] },
    ]);
  });
});

function createEntry(timestamp: number, shoulderTilt: number): SessionLogEntry {
  return {
    timestamp,
    groundTruth: shoulderTilt > 0 ? "FORWARD_LEAN" : "NORMAL_WORK",
    cameraState: "VALID",
    confidence: 0.95,
    features: {
      shoulderTilt,
      headXOffset: 0,
      shoulderXOffset: 0.5,
      shoulderYOffset: 0.4,
      bodyScale: 1,
      faceToShoulderRatio: 0.28,
      pitchProxy: 0.2,
      motionEnergy: 0.05,
    },
  };
}
