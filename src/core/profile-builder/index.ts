import type { FrameFeature, UserProfile } from "../types";

// TODO(B): collect ~30s of calibration FrameFeatures, drop low-confidence /
// high-motion frames, and derive originalCenters + featureDeviations
// (median/MAD or mean/std — see plan.md section 6.2 and section 12).
export function buildUserProfile(calibrationFrames: FrameFeature[]): UserProfile {
  void calibrationFrames;
  throw new Error("not implemented");
}
