import { describe, expect, it } from "vitest";
import type { FrameFeature } from "../types";
import { MovementClassifier } from "./index";

function feature(overrides: Partial<FrameFeature> = {}): FrameFeature {
  return {
    timestamp: 0,
    confidence: 0.95,
    shoulderTilt: 0,
    headXOffset: 0,
    shoulderXOffset: 0,
    shoulderYOffset: 0,
    bodyScale: 1,
    motionEnergy: 0,
    headXRatio: 0,
    headYRatio: 0,
    shoulderAsymmetry: 0,
    ...overrides,
  };
}

describe("MovementClassifier", () => {
  it("does not classify small landmark jitter as a movement", () => {
    const classifier = new MovementClassifier();
    classifier.update(feature());

    const result = classifier.update(
      feature({
        timestamp: 1000,
        shoulderXOffset: 0.004,
        shoulderTilt: 0.8,
        headXRatio: 0.004,
        shoulderAsymmetry: 0.003,
        motionEnergy: 0.01,
      }),
    );

    expect(result.context).toBe("NONE");
  });

  it("recognizes coherent background movement as camera movement", () => {
    const classifier = new MovementClassifier();
    classifier.update(feature());

    const result = classifier.update(
      feature({ timestamp: 1000, shoulderXOffset: 0.04, motionEnergy: 0.09, backgroundMotion: 0.1 }),
    );

    expect(result.context).toBe("CAMERA_MOVEMENT");
  });

  it("recognizes rigid body translation as chair movement", () => {
    const classifier = new MovementClassifier();
    classifier.update(feature());

    const result = classifier.update(
      feature({ timestamp: 1000, shoulderXOffset: 0.04, motionEnergy: 0.09 }),
    );

    expect(result.context).toBe("CHAIR_MOVEMENT");
  });

  it("uses relative feature change to separate side shift from rigid movement", () => {
    const classifier = new MovementClassifier();
    classifier.update(feature());

    const result = classifier.update(
      feature({
        timestamp: 1000,
        shoulderXOffset: 0.04,
        headXRatio: 0.04,
        shoulderAsymmetry: 0.02,
        motionEnergy: 0.09,
      }),
    );

    expect(result.context).toBe("SIDE_SHIFT");
  });

  it("uses shoulder tilt and relative change to recognize armrest leaning", () => {
    const classifier = new MovementClassifier();
    classifier.update(feature());

    const result = classifier.update(
      feature({
        timestamp: 1000,
        shoulderXOffset: 0.04,
        shoulderTilt: 4,
        headYRatio: 0.03,
        shoulderAsymmetry: 0.02,
        motionEnergy: 0.09,
      }),
    );

    expect(result.context).toBe("ARMREST_LEAN");
  });
});
