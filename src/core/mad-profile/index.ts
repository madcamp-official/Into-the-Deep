import type { FeatureVector, FrameFeature, MADProfile, PostureFeatureName } from "../types";

export const MAD_FEATURES: readonly PostureFeatureName[] = [
  "shoulderTilt",
  "headXOffset",
  "shoulderXOffset",
  "shoulderYOffset",
  "bodyScale",
  "shoulderAsymmetry",
  "shoulderCenterX",
  "shoulderCenterY",
  "headXRatio",
  "headYRatio",
  "headShoulderDistanceRatio",
  "faceToShoulderRatio",
  "faceToShoulderRatioDelta",
  "pitchProxy",
  "yawProxy",
  "correctedYaw",
  "headRoll",
  "faceShapeDeformation",
  "forwardLeanProxy",
  "bodyCompressionRatio",
  "shoulderWidthRatio",
  "relativeShoulderScale",
  "shoulderDepthAsymmetry",
  "torsoRotationProxy",
  "handFaceDistance",
  "handShoulderDistance",
  "motionEnergy",
  "faceSize",
];

// Conservative starting scales. Development-session analysis should replace
// these values before a final comparison.
export const DEFAULT_MAD_VALUES: FeatureVector = {
  shoulderTilt: 4,
  headXOffset: 0.04,
  shoulderXOffset: 0.04,
  shoulderYOffset: 0.04,
  bodyScale: 0.08,
  shoulderAsymmetry: 0.04,
  shoulderCenterX: 0.04,
  shoulderCenterY: 0.04,
  headXRatio: 0.04,
  headYRatio: 0.04,
  headShoulderDistanceRatio: 0.04,
  faceToShoulderRatio: 0.01,
  faceToShoulderRatioDelta: 0.01,
  pitchProxy: 0.02,
  yawProxy: 0.05,
  correctedYaw: 0.05,
  headRoll: 3,
  faceShapeDeformation: 0.03,
  forwardLeanProxy: 0.04,
  bodyCompressionRatio: 0.04,
  shoulderWidthRatio: 0.04,
  relativeShoulderScale: 0.04,
  shoulderDepthAsymmetry: 0.04,
  torsoRotationProxy: 0.04,
  handFaceDistance: 0.05,
  handShoulderDistance: 0.05,
  motionEnergy: 0.05,
  // Raw eye-to-eye distance (see feature-normalizer's faceSize) — same
  // rough scale as faceToShoulderRatio's 0.01 since both derive from
  // eyeDistance, just not divided by shoulderWidth here.
  faceSize: 0.01,
};

export interface MadProfileOptions {
  now?: number;
  values?: FeatureVector;
  min?: FeatureVector;
  max?: FeatureVector;
}

export function createInitialMADProfile(options: MadProfileOptions = {}): MADProfile {
  const values = { ...DEFAULT_MAD_VALUES, ...options.values };
  const min = options.min ?? scaleValues(values, 0.5);
  const max = options.max ?? scaleValues(values, 4);
  const now = options.now ?? Date.now();

  return {
    values,
    min,
    max,
    initializedAt: now,
    updatedAt: now,
    updateCount: 0,
  };
}

export function normalizeFeature(
  value: number | undefined,
  center: number | undefined,
  mad: number | undefined,
): number | undefined {
  if (value === undefined || center === undefined || mad === undefined || mad <= 0) {
    return undefined;
  }
  return (value - center) / mad;
}

export function normalizeFrameFeature(
  frame: FrameFeature,
  centers: Record<string, number>,
  profile: MADProfile,
): FeatureVector {
  const result: FeatureVector = {};
  for (const feature of MAD_FEATURES) {
    const value = normalizeFeature(frame[feature], centers[feature], profile.values[feature]);
    if (value !== undefined) result[feature] = value;
  }
  return result;
}

export function updateMADProfile(
  profile: MADProfile,
  windowMad: FeatureVector,
  alpha = 0.95,
  now = Date.now(),
): MADProfile {
  const values: FeatureVector = { ...profile.values };
  for (const feature of MAD_FEATURES) {
    const sample = windowMad[feature];
    const previous = profile.values[feature];
    if (sample === undefined || previous === undefined) continue;
    const next = alpha * previous + (1 - alpha) * sample;
    values[feature] = clamp(next, profile.min[feature], profile.max[feature]);
  }
  return { ...profile, values, updatedAt: now, updateCount: profile.updateCount + 1 };
}

export function calculateMAD(values: readonly number[], center = median(values)): number | undefined {
  if (values.length === 0) return undefined;
  return median(values.map((value) => Math.abs(value - center)));
}

function scaleValues(values: FeatureVector, factor: number): FeatureVector {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, Math.max(value * factor, Number.EPSILON)]),
  );
}

function clamp(value: number, min: number | undefined, max: number | undefined): number {
  return Math.min(max ?? value, Math.max(min ?? 0, value));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}
