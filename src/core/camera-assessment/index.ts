import type { CameraAssessment, CameraTransform } from "../types";

const ADJUSTED_TRANSLATION = 0.035;
const ADJUSTED_SCALE = 0.06;
const ADJUSTED_ROLL = 0.05;
const ADJUSTED_YAW = 0.02;
const ADJUSTED_PITCH = 0.02;
const RECALIBRATION_TRANSLATION = 0.14;
const RECALIBRATION_SCALE = 0.2;
const RECALIBRATION_ROLL = 0.2;
const RECALIBRATION_YAW = 0.08;
const RECALIBRATION_PITCH = 0.08;
const MIN_TRACKED_POINTS = 8;
const MIN_INLIER_RATIO = 0.6;
const MAX_REPROJECTION_ERROR = 3;

export function assessCameraTransform(
  transform: CameraTransform | null,
): CameraAssessment {
  if (!transform) {
    return {
      timestamp: 0,
      state: "UNKNOWN",
      scaleCorrection: 0,
      offsetX: 0,
      offsetY: 0,
      reliability: 0,
      reason: ["background features are not initialized"],
      qualityStatus: "DEGRADED",
      qualityRecoveryFrames: 0,
    };
  }

  const reliable = isQualityGood(transform);
  const translation = Math.hypot(transform.translationX, transform.translationY);
  const recalibration = translation > RECALIBRATION_TRANSLATION ||
    Math.abs(transform.scale) > RECALIBRATION_SCALE ||
    Math.abs(transform.roll) > RECALIBRATION_ROLL ||
    Math.abs(transform.yawProxy ?? 0) > RECALIBRATION_YAW ||
    Math.abs(transform.pitchProxy ?? 0) > RECALIBRATION_PITCH;
  const changed = translation > ADJUSTED_TRANSLATION ||
    Math.abs(transform.scale) > ADJUSTED_SCALE ||
    Math.abs(transform.roll) > ADJUSTED_ROLL ||
    Math.abs(transform.yawProxy ?? 0) > ADJUSTED_YAW ||
    Math.abs(transform.pitchProxy ?? 0) > ADJUSTED_PITCH;
  const reason: string[] = [];
  if (!reliable) reason.push("background tracking confidence is low");
  if (Math.abs(transform.translationX) > ADJUSTED_TRANSLATION) reason.push("camera translation X changed");
  if (Math.abs(transform.translationY) > ADJUSTED_TRANSLATION) reason.push("camera translation Y changed");
  if (Math.abs(transform.scale) > ADJUSTED_SCALE) reason.push("camera distance/zoom changed");
  if (Math.abs(transform.roll) > ADJUSTED_ROLL) reason.push("camera roll changed");
  if (Math.abs(transform.yawProxy ?? 0) > ADJUSTED_YAW) reason.push("camera yaw changed");
  if (Math.abs(transform.pitchProxy ?? 0) > ADJUSTED_PITCH) reason.push("camera pitch changed");

  return {
    timestamp: transform.timestamp,
    state: !reliable ? "UNKNOWN" : recalibration ? "RECALIBRATION_REQUIRED" : changed ? "ADJUSTED" : "VALID",
    scaleCorrection: transform.scale,
    offsetX: transform.translationX,
    offsetY: transform.translationY,
    reliability: transform.confidence,
    reason,
    backgroundTransformConfidence: transform.confidence,
    transform,
    qualityStatus: reliable ? "OK" : "DEGRADED",
    qualityRecoveryFrames: reliable ? 5 : 0,
  };
}

const UNKNOWN_GRACE_MS = 500;
const UNKNOWN_WARNING_MS = 1500;
const REQUIRED_STABLE_FRAMES = 3;
const MOTION_ONSET_THRESHOLD = 0.02;
const MOTION_END_THRESHOLD = 0.01;
const SETTLING_DELAY_MS = 450;
const REQUIRED_MOTION_ONSET_FRAMES = 3;
const SLOW_MOTION_FRAME_THRESHOLD = 0.003;
const SLOW_MOTION_ACCUMULATION_THRESHOLD = 0.025;
const REQUIRED_SLOW_MOTION_FRAMES = 5;
const QUALITY_RECOVERY_REQUIRED_FRAMES = 5;
const QUALITY_RECALIBRATION_MS = 2000;

// Keeps short tracking gaps from becoming camera-change alerts. A prolonged
// gap remains UNKNOWN so the UI can ask the user to check the camera.
export class CameraAssessmentTracker {
  private stable: CameraAssessment | null = null;
  private unknownSince: number | null = null;
  private candidateState: CameraAssessment["state"] | null = null;
  private candidateCount = 0;
  private motionCandidateCount = 0;
  private slowMotionAccumulated = 0;
  private slowMotionFrames = 0;
  private motionPhase: NonNullable<CameraAssessment["motionPhase"]> = "STABLE";
  private lastMotionAt = 0;
  private episodeFrameCount = 0;
  private episodeUnknownFrameCount = 0;
  private episodeTransforms: CameraTransform[] = [];
  private qualityBadSince: number | null = null;
  private qualityRecoveryFrames = 0;
  private qualityStatus: NonNullable<CameraAssessment["qualityStatus"]> = "OK";

  reset(): void {
    this.stable = null;
    this.unknownSince = null;
    this.candidateState = null;
    this.candidateCount = 0;
    this.motionCandidateCount = 0;
    this.slowMotionAccumulated = 0;
    this.slowMotionFrames = 0;
    this.motionPhase = "STABLE";
    this.lastMotionAt = 0;
    this.episodeFrameCount = 0;
    this.episodeUnknownFrameCount = 0;
    this.episodeTransforms = [];
    this.qualityBadSince = null;
    this.qualityRecoveryFrames = 0;
    this.qualityStatus = "OK";
  }

  update(transform: CameraTransform | null, timestamp: number): CameraAssessment {
    const reliable = Boolean(transform && isQualityGood(transform));
    const motionMagnitude = transform
      ? Math.abs(transform.translationX) +
        Math.abs(transform.translationY) +
        Math.abs(transform.scale) +
        Math.abs(transform.roll) +
        Math.abs(transform.yawProxy ?? 0) +
        Math.abs(transform.pitchProxy ?? 0)
      : 0;
    let episodeFinished = false;
    const slowMotionEvidence = reliable && motionMagnitude >= SLOW_MOTION_FRAME_THRESHOLD;
    if (slowMotionEvidence) {
      this.slowMotionAccumulated += motionMagnitude;
      this.slowMotionFrames += 1;
    } else if (reliable) {
      this.slowMotionAccumulated *= 0.5;
      this.slowMotionFrames = 0;
    }
    const sustainedSlowMotion = this.slowMotionFrames >= REQUIRED_SLOW_MOTION_FRAMES &&
      this.slowMotionAccumulated >= SLOW_MOTION_ACCUMULATION_THRESHOLD;

    if (this.motionPhase === "STABLE") {
      if (reliable && (motionMagnitude >= MOTION_ONSET_THRESHOLD || sustainedSlowMotion)) {
        this.motionCandidateCount += 1;
        if (this.motionCandidateCount >= REQUIRED_MOTION_ONSET_FRAMES) {
          this.motionPhase = "MOVING";
          this.lastMotionAt = timestamp;
          this.episodeFrameCount = 0;
          this.episodeUnknownFrameCount = 0;
          this.episodeTransforms = [];
          this.motionCandidateCount = 0;
          this.slowMotionAccumulated = 0;
          this.slowMotionFrames = 0;
        }
      } else {
        this.motionCandidateCount = 0;
      }
    } else {
      if (motionMagnitude >= MOTION_END_THRESHOLD || sustainedSlowMotion) {
        this.motionPhase = "MOVING";
        this.lastMotionAt = timestamp;
      } else if (timestamp - this.lastMotionAt >= SETTLING_DELAY_MS) {
        episodeFinished = this.motionPhase === "SETTLING" &&
            timestamp - this.lastMotionAt >= SETTLING_DELAY_MS + 350
          ;
        this.motionPhase = episodeFinished ? "STABLE" : "SETTLING";
      }
    }

    if (this.motionPhase !== "STABLE") {
      if (reliable) {
        this.episodeFrameCount += 1;
        this.episodeTransforms.push(transform!);
      }
      else this.episodeUnknownFrameCount += 1;
    }

    if (!reliable) {
      if (this.qualityBadSince === null) this.qualityBadSince = timestamp;
      this.qualityRecoveryFrames = 0;
      const qualityElapsed = timestamp - this.qualityBadSince;
      this.qualityStatus = qualityElapsed >= QUALITY_RECALIBRATION_MS
        ? "RECALIBRATION_REQUIRED"
        : "DEGRADED";
      if (this.unknownSince === null) this.unknownSince = timestamp;
      const elapsed = timestamp - this.unknownSince;
      if (this.stable && elapsed < UNKNOWN_GRACE_MS) {
        return this.withMotionInfo({
          ...this.stable,
          timestamp,
          reliability: transform?.confidence ?? 0,
          reason: ["brief background tracking gap; previous state held"],
          qualityStatus: this.qualityStatus,
          qualityRecoveryFrames: 0,
        });
      }
      const requireRecalibration = qualityElapsed >= QUALITY_RECALIBRATION_MS &&
        this.motionPhase === "STABLE";
      return this.withMotionInfo({
        timestamp,
        state: requireRecalibration ? "RECALIBRATION_REQUIRED" : "UNKNOWN",
        scaleCorrection: transform?.scale ?? 0,
        offsetX: transform?.translationX ?? 0,
        offsetY: transform?.translationY ?? 0,
        reliability: transform?.confidence ?? 0,
        reason: [
          requireRecalibration
            ? "camera tracking did not recover; recalibration is required"
            : elapsed >= UNKNOWN_WARNING_MS
              ? "background tracking unavailable; check the camera view"
            : "background tracking temporarily unavailable",
        ],
        backgroundTransformConfidence: transform?.confidence ?? 0,
        ...(transform ? { transform } : {}),
        qualityStatus: this.qualityStatus,
        qualityRecoveryFrames: 0,
      });
    }

    // `reliable` is derived from the transform, but TypeScript cannot use
    // that boolean to narrow the nullable value. Keep the null case explicit
    // so later recovery and episode calculations can safely use the transform.
    if (!transform) {
      return this.withMotionInfo({
        timestamp,
        state: "UNKNOWN",
        scaleCorrection: 0,
        offsetX: 0,
        offsetY: 0,
        reliability: 0,
        reason: ["background tracking unavailable"],
        qualityStatus: "DEGRADED",
        qualityRecoveryFrames: 0,
      });
    }

    this.unknownSince = null;
    if (this.qualityStatus !== "OK") {
      this.qualityRecoveryFrames += 1;
      this.qualityStatus = "RECOVERING";
      if (this.qualityRecoveryFrames < QUALITY_RECOVERY_REQUIRED_FRAMES) {
        return this.withMotionInfo({
          ...(this.stable ?? assessCameraTransform(transform)),
          timestamp,
          state: "UNKNOWN",
          transform,
          reason: [`camera tracking recovering (${this.qualityRecoveryFrames}/${QUALITY_RECOVERY_REQUIRED_FRAMES})`],
          qualityStatus: "RECOVERING",
          qualityRecoveryFrames: this.qualityRecoveryFrames,
        });
      }
      this.qualityStatus = "OK";
      this.qualityBadSince = null;
    }
    const nextTransform = episodeFinished
      ? transform.keyframeTransform
        ? { ...transform, ...transform.keyframeTransform }
        : buildEpisodeTransform(transform, this.episodeTransforms)
      : transform;
    const next = assessCameraTransform(nextTransform);
    if (!this.stable) {
      this.stable = next;
      return this.withMotionInfo(next);
    }
    if (episodeFinished) {
      this.stable = next;
      this.candidateState = null;
      this.candidateCount = 0;
      return this.withMotionInfo(next);
    }
    if (this.motionPhase !== "STABLE") {
      return this.withMotionInfo({
        ...this.stable,
        timestamp,
        transform,
        reason: ["camera movement in progress; judgment paused"],
      });
    }
    if (next.state === this.stable.state) {
      this.candidateState = null;
      this.candidateCount = 0;
      this.stable = next;
      return this.withMotionInfo(next);
    }
    if (this.candidateState !== next.state) {
      this.candidateState = next.state;
      this.candidateCount = 1;
    } else {
      this.candidateCount += 1;
    }
    if (this.candidateCount < REQUIRED_STABLE_FRAMES) {
      return this.withMotionInfo({
        ...this.stable,
        timestamp,
        transform,
        reason: [`pending ${next.state} confirmation (${this.candidateCount}/${REQUIRED_STABLE_FRAMES})`],
      });
    }
    this.stable = next;
    this.candidateState = null;
    this.candidateCount = 0;
    return this.withMotionInfo(next);
  }

  private withMotionInfo(assessment: CameraAssessment): CameraAssessment {
    return {
      ...assessment,
      motionPhase: this.motionPhase,
      episodeFrameCount: this.episodeFrameCount,
      episodeUnknownFrameCount: this.episodeUnknownFrameCount,
      qualityStatus: this.qualityStatus,
      qualityRecoveryFrames: this.qualityRecoveryFrames,
    };
  }
}

function isQualityGood(transform: CameraTransform): boolean {
  return transform.trackedPointCount >= MIN_TRACKED_POINTS &&
    transform.confidence >= 0.45 &&
    transform.inlierRatio >= MIN_INLIER_RATIO &&
    transform.reprojectionError <= MAX_REPROJECTION_ERROR;
}

function buildEpisodeTransform(
  latest: CameraTransform,
  transforms: readonly CameraTransform[],
): CameraTransform {
  if (transforms.length === 0) return latest;
  return {
    ...latest,
    translationX: transforms.reduce((sum, value) => sum + value.translationX, 0),
    translationY: transforms.reduce((sum, value) => sum + value.translationY, 0),
    scale: transforms.reduce((sum, value) => sum + value.scale, 0),
    roll: transforms.reduce((sum, value) => sum + value.roll, 0),
    ...(transforms.some((value) => value.yawProxy !== undefined)
      ? { yawProxy: median(transforms.map((value) => value.yawProxy ?? 0)) }
      : {}),
    ...(transforms.some((value) => value.pitchProxy !== undefined)
      ? { pitchProxy: median(transforms.map((value) => value.pitchProxy ?? 0)) }
      : {}),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
