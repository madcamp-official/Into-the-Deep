import type { FrameFeature, MovementContext } from "../types";

export interface MovementAssessment {
  context: MovementContext;
  translationVelocity: number;
  relativeChange: number;
  onset: "HEAD_FIRST" | "SHOULDER_FIRST" | "SIMULTANEOUS" | "NONE";
}

const CAMERA_MOTION_THRESHOLD = 0.08;
const TRANSLATION_VELOCITY_THRESHOLD = 0.03;
const RELATIVE_CHANGE_THRESHOLD = 0.05;
const SHOULDER_TILT_CHANGE_THRESHOLD = 4;
const FRAME_RELATIVE_MOTION_THRESHOLD = 0.04;
const MOTION_ENERGY_THRESHOLD = 0.08;
const MIN_EPISODE_DURATION_MS = 450;
const MAX_EPISODE_IDLE_MS = 900;

interface MotionSnapshot {
  feature: FrameFeature;
  timestamp: number;
}

/**
 * Separates body-relative movement from near-rigid screen translation.
 * This is intentionally a context signal, not a posture alert by itself:
 * a chair move and a perfectly rigid side shift are visually ambiguous.
 */
export class MovementClassifier {
  private previous: MotionSnapshot | null = null;
  private episodeStart: MotionSnapshot | null = null;
  private lastMovingAt = 0;

  update(feature: FrameFeature): MovementAssessment {
    const previous = this.previous;
    this.previous = { feature, timestamp: feature.timestamp };

    if (!previous) return this.assessment("NONE", 0, 0, "NONE");

    const elapsedSeconds = Math.max((feature.timestamp - previous.timestamp) / 1000, 0.001);
    const translationDelta = Math.abs(feature.shoulderXOffset - previous.feature.shoulderXOffset);
    const headRelativeDelta = Math.abs(
      (feature.headXRatio ?? 0) - (previous.feature.headXRatio ?? 0),
    );
    const shoulderTiltDelta = Math.abs(feature.shoulderTilt - previous.feature.shoulderTilt);
    const relativeChange =
      headRelativeDelta +
      Math.abs((feature.headYRatio ?? 0) - (previous.feature.headYRatio ?? 0)) +
      Math.abs((feature.shoulderAsymmetry ?? 0) - (previous.feature.shoulderAsymmetry ?? 0)) +
      shoulderTiltDelta / 30;
    const translationVelocity = translationDelta / elapsedSeconds;
    const moving =
      translationVelocity > TRANSLATION_VELOCITY_THRESHOLD ||
      relativeChange > FRAME_RELATIVE_MOTION_THRESHOLD ||
      feature.motionEnergy > MOTION_ENERGY_THRESHOLD;

    if (!moving) {
      if (this.episodeStart && feature.timestamp - this.lastMovingAt > MAX_EPISODE_IDLE_MS) {
        this.episodeStart = null;
      }
      return this.assessment("NONE", translationVelocity, relativeChange, "NONE");
    }

    this.lastMovingAt = feature.timestamp;
    if (!this.episodeStart) this.episodeStart = previous;

    const episode = this.episodeStart.feature;
    const episodeDuration = feature.timestamp - this.episodeStart.timestamp;
    const episodeTiltChange = Math.abs(feature.shoulderTilt - episode.shoulderTilt);
    const episodeRelativeChange =
      Math.abs((feature.headXRatio ?? 0) - (episode.headXRatio ?? 0)) +
      Math.abs((feature.headYRatio ?? 0) - (episode.headYRatio ?? 0)) +
      Math.abs((feature.shoulderAsymmetry ?? 0) - (episode.shoulderAsymmetry ?? 0));
    const headDelta = Math.abs(feature.headXOffset - previous.feature.headXOffset);
    const shoulderDelta = Math.abs(
      feature.shoulderXOffset - previous.feature.shoulderXOffset,
    );
    const onset =
      headDelta > shoulderDelta * 1.25
        ? "HEAD_FIRST"
        : shoulderDelta > headDelta * 1.25
          ? "SHOULDER_FIRST"
          : "SIMULTANEOUS";

    if ((feature.backgroundMotion ?? 0) >= CAMERA_MOTION_THRESHOLD) {
      return this.assessment("CAMERA_MOVEMENT", translationVelocity, relativeChange, onset);
    }

    if (
      episodeDuration >= MIN_EPISODE_DURATION_MS &&
      episodeTiltChange >= SHOULDER_TILT_CHANGE_THRESHOLD &&
      episodeRelativeChange >= RELATIVE_CHANGE_THRESHOLD
    ) {
      return this.assessment("ARMREST_LEAN", translationVelocity, relativeChange, onset);
    }

    if (
      episodeDuration >= MIN_EPISODE_DURATION_MS &&
      translationVelocity >= TRANSLATION_VELOCITY_THRESHOLD &&
      episodeRelativeChange >= RELATIVE_CHANGE_THRESHOLD
    ) {
      return this.assessment("SIDE_SHIFT", translationVelocity, relativeChange, onset);
    }

    if (
      episodeDuration >= MIN_EPISODE_DURATION_MS &&
      translationVelocity >= TRANSLATION_VELOCITY_THRESHOLD &&
      episodeRelativeChange < RELATIVE_CHANGE_THRESHOLD
    ) {
      return this.assessment("CHAIR_MOVEMENT", translationVelocity, relativeChange, onset);
    }

    return this.assessment("UNKNOWN", translationVelocity, relativeChange, onset);
  }

  reset(): void {
    this.previous = null;
    this.episodeStart = null;
    this.lastMovingAt = 0;
  }

  private assessment(
    context: MovementContext,
    translationVelocity: number,
    relativeChange: number,
    onset: MovementAssessment["onset"],
  ): MovementAssessment {
    return { context, translationVelocity, relativeChange, onset };
  }
}
