import type {
  FrameFeature,
  LandmarkQuality,
  MADProfile,
  PostureFeatureName,
  PostureType,
} from "../types";
import { calculateMAD, MAD_FEATURES, updateMADProfile } from "../mad-profile";

export interface V2MadUpdaterOptions {
  stableWindowMs?: number;
  minStableDurationMs?: number;
  alpha?: number;
  motionEnergyThreshold?: number;
  minConfidence?: number;
  centers?: Partial<Record<PostureFeatureName, number>>;
}

export interface V2MadUpdateContext {
  landmarkQuality?: Pick<LandmarkQuality, "reliable" | "confidence">;
  matchedPosture?: PostureType;
}

export const DEFAULT_V2_MAD_OPTIONS: Required<V2MadUpdaterOptions> = {
  stableWindowMs: 5000,
  minStableDurationMs: 3000,
  alpha: 0.95,
  motionEnergyThreshold: 0.2,
  minConfidence: 0.8,
  centers: {},
};

export class V2MadUpdater {
  private readonly options: Required<V2MadUpdaterOptions>;
  private profile: MADProfile;
  private stableStartedAt: number | null = null;
  private samples: Partial<Record<(typeof MAD_FEATURES)[number], number[]>> = {};
  private lastSampleAt: number | null = null;

  constructor(profile: MADProfile, options: V2MadUpdaterOptions = {}) {
    this.profile = profile;
    this.options = { ...DEFAULT_V2_MAD_OPTIONS, ...options };
  }

  update(frame: FrameFeature, context: V2MadUpdateContext = {}): MADProfile {
    if (!this.isStable(frame, context)) {
      this.resetWindow();
      return this.profile;
    }

    if (this.stableStartedAt === null) this.stableStartedAt = frame.timestamp;
    this.lastSampleAt = frame.timestamp;
    for (const feature of MAD_FEATURES) {
      const value = frame[feature];
      if (value === undefined) continue;
      (this.samples[feature] ??= []).push(value);
    }

    const stableDuration = frame.timestamp - this.stableStartedAt;
    const windowDuration = this.lastSampleAt - this.stableStartedAt;
    if (stableDuration < this.options.minStableDurationMs || windowDuration < this.options.stableWindowMs) {
      return this.profile;
    }

    const windowMad = Object.fromEntries(
      MAD_FEATURES.flatMap((feature) => {
        const values = this.samples[feature] ?? [];
        const center = this.options.centers[feature] ?? (values.length > 0 ? median(values) : undefined);
        const mad = center === undefined ? undefined : calculateMAD(values, center);
        return mad === undefined ? [] : [[feature, mad]];
      }),
    );
    this.profile = updateMADProfile(this.profile, windowMad, this.options.alpha, frame.timestamp);
    this.resetWindow();
    return this.profile;
  }

  getProfile(): MADProfile {
    return this.profile;
  }

  resetWindow(): void {
    this.stableStartedAt = null;
    this.lastSampleAt = null;
    this.samples = {};
  }

  private isStable(frame: FrameFeature, context: V2MadUpdateContext): boolean {
    if (frame.confidence < this.options.minConfidence) return false;
    if (frame.motionEnergy > this.options.motionEnergyThreshold) return false;
    if (context.landmarkQuality?.reliable === false) return false;
    if (
      context.landmarkQuality?.confidence !== undefined &&
      context.landmarkQuality.confidence < this.options.minConfidence
    ) return false;
    if (context.matchedPosture) return false;
    return true;
  }
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}
