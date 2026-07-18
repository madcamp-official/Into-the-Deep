import { evaluateV0 } from "./fixed-threshold-detector";
import { buildUserProfile } from "./profile-builder";
import type { DetectionEvent, FrameFeature, UserProfile } from "./types";

export interface ProfileBaselineDemoResult {
  profile: UserProfile;
  stableResult: DetectionEvent;
  driftResult: DetectionEvent;
}

export const stableCalibrationFrames: FrameFeature[] = [
  {
    timestamp: 0,
    confidence: 0.96,
    shoulderTilt: 1.8,
    headXOffset: 0.02,
    shoulderXOffset: 0.5,
    shoulderYOffset: 0.42,
    bodyScale: 1,
    torsoLean: 2,
    motionEnergy: 0.04,
  },
  {
    timestamp: 1,
    confidence: 0.95,
    shoulderTilt: 2,
    headXOffset: 0.03,
    shoulderXOffset: 0.505,
    shoulderYOffset: 0.425,
    bodyScale: 1.01,
    torsoLean: 2.2,
    motionEnergy: 0.05,
  },
  {
    timestamp: 2,
    confidence: 0.72,
    shoulderTilt: 12,
    headXOffset: 0.6,
    shoulderXOffset: 0.7,
    shoulderYOffset: 0.6,
    bodyScale: 1.4,
    motionEnergy: 0.7,
  },
];

export const stableCheckFrame: FrameFeature = {
  timestamp: 3,
  confidence: 0.97,
  shoulderTilt: 1.9,
  headXOffset: 0.025,
  shoulderXOffset: 0.502,
  shoulderYOffset: 0.422,
  bodyScale: 1.005,
  torsoLean: 2.1,
  motionEnergy: 0.04,
};

export const driftCheckFrame: FrameFeature = {
  timestamp: 4,
  confidence: 0.95,
  shoulderTilt: 10.5,
  headXOffset: 0.32,
  shoulderXOffset: 0.75,
  shoulderYOffset: 0.65,
  bodyScale: 1.33,
  torsoLean: 14,
  motionEnergy: 0.06,
};

export function runProfileBaselineDemo(): ProfileBaselineDemoResult {
  const profile = buildUserProfile(stableCalibrationFrames);

  return {
    profile,
    stableResult: evaluateV0(stableCheckFrame, profile.originalCenters),
    driftResult: evaluateV0(driftCheckFrame, profile.originalCenters),
  };
}
