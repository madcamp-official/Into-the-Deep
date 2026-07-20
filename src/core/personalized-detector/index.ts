import type {
  DetectionEvent,
  DriftObservation,
  FrameFeature,
  UserProfile,
} from "../types";

// shoulderXOffset/shoulderYOffset deliberately excluded — they're
// shoulderCenter/shoulderWidth, an absolute screen position divided by
// scale rather than a difference of two points, so sliding a chair back
// shrinks shoulderWidth while shoulderCenter barely moves and the ratio
// grows with zero real posture change (same bug fixed in V0's
// fixed-threshold-detector; reproduced live via chair movement with the
// camera untouched).
const V1_FEATURES = [
  "shoulderTilt",
  "headXOffset",
  "faceToShoulderRatio",
  "pitchProxy",
  "yawProxy",
  // headShoulderDistanceRatio catches turtle neck (head extending away from
  // shoulders); bodyCompressionRatio catches slouching/sitting low (head
  // compressing toward shoulders) — both from feature_discussion, computed
  // by feature-normalizer and now profiled by profile-builder.
  "headShoulderDistanceRatio",
  "bodyCompressionRatio",
] as const satisfies readonly (keyof FrameFeature)[];

type V1Feature = (typeof V1_FEATURES)[number];

export interface PersonalizedThresholds {
  driftScore: number;
  sustainedSeconds: number;
  minimumDeviations: Record<V1Feature, number>;
}

export interface PersonalizedDetectionResult {
  observation: DriftObservation;
  event: DetectionEvent;
}

export const DEFAULT_PERSONALIZED_THRESHOLDS: PersonalizedThresholds = {
  driftScore: 3,
  sustainedSeconds: 1.5,
  // A short calibration can have an MAD of 0 even though the landmarks
  // naturally fluctuate. These floors keep one nearly-static feature from
  // dominating the score because of measurement noise alone.
  minimumDeviations: {
    shoulderTilt: 1,
    headXOffset: 0.02,
    faceToShoulderRatio: 0.005,
    pitchProxy: 0.005,
    yawProxy: 0.03,
    headShoulderDistanceRatio: 0.02,
    bodyCompressionRatio: 0.02,
  },
};

export function evaluateV1(
  feature: FrameFeature,
  profile: UserProfile,
  thresholds: PersonalizedThresholds = DEFAULT_PERSONALIZED_THRESHOLDS,
): DriftObservation {
  const deviations = V1_FEATURES.flatMap((featureName) => {
    const value = feature[featureName];
    const center = profile.adaptiveCenters[featureName];
    const mad = profile.featureDeviations[featureName];

    if (value === undefined || center === undefined || mad === undefined) {
      return [];
    }

    return [{
      featureName,
      score: Math.abs(value - center) / Math.max(mad, thresholds.minimumDeviations[featureName]),
    }];
  }).sort((left, right) => right.score - left.score);

  const dominant = deviations.slice(0, 2);
  const driftScore = dominant.length === 0
    ? 0
    : dominant.reduce((sum, deviation) => sum + deviation.score, 0) / dominant.length;

  return {
    timestamp: feature.timestamp,
    driftScore,
    reliability: feature.confidence,
    dominantFeatures: dominant
      .filter((deviation) => deviation.score > 0)
      .map((deviation) => deviation.featureName),
  };
}

export class PersonalizedDriftDetector {
  private driftStartedAt: number | null = null;
  private readonly profile: UserProfile;
  private readonly thresholds: PersonalizedThresholds;

  constructor(
    profile: UserProfile,
    thresholds: PersonalizedThresholds = DEFAULT_PERSONALIZED_THRESHOLDS,
  ) {
    this.profile = profile;
    this.thresholds = thresholds;
  }

  update(feature: FrameFeature): PersonalizedDetectionResult {
    const observation = evaluateV1(feature, this.profile, this.thresholds);
    const bad = observation.driftScore >= this.thresholds.driftScore;

    if (!bad) {
      this.reset();
      return {
        observation,
        event: createEvent(feature.timestamp, false, false, []),
      };
    }

    if (
      this.driftStartedAt === null ||
      feature.timestamp < this.driftStartedAt
    ) {
      this.driftStartedAt = feature.timestamp;
    }

    const sustainedSeconds = (feature.timestamp - this.driftStartedAt) / 1000;

    return {
      observation,
      event: createEvent(
        feature.timestamp,
        true,
        sustainedSeconds >= this.thresholds.sustainedSeconds,
        observation.dominantFeatures,
      ),
    };
  }

  reset(): void {
    this.driftStartedAt = null;
  }
}

function createEvent(
  timestamp: number,
  bad: boolean,
  alert: boolean,
  reason: string[],
): DetectionEvent {
  return {
    timestamp,
    state: bad ? "BAD" : "STABLE",
    alert,
    reason,
  };
}
