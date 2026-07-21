import type { CameraTransform, ScenarioLabel } from "../../core/types";
import type { SessionLogEntry } from "../recorder";

export interface CameraVerificationMetrics {
  sessionType: "CAMERA";
  frameCount: number;
  scenarioCount: number;
  detectedScenarioCount: number;
  detectionRate: number;
  falsePositiveCount: number;
  falsePositiveRate: number;
  unknownFrameCount: number;
  unknownRate: number;
  averageDetectionDelaySeconds: number | null;
  averageTrackedPointCount: number;
  averageInlierRatio: number;
  averageReprojectionError: number;
  directionAccuracy: number | null;
  recoveryRate: number | null;
  scenarios: CameraScenarioResult[];
  notes: string[];
}

export interface CameraScenarioResult {
  label: ScenarioLabel["label"];
  startedAt: number;
  detectedAt: number | null;
  detectionDelaySeconds: number | null;
  expectedDirection: string;
  observedDirection: string;
  recovered: boolean | null;
  reliableFrameCount?: number;
  unknownFrameCount?: number;
}

const CAMERA_LABELS = new Set<ScenarioLabel["label"]>([
  "CAMERA_TRANSLATION_X",
  "CAMERA_TRANSLATION_Y",
  "CAMERA_ROLL",
  "CAMERA_YAW_LEFT",
  "CAMERA_YAW_RIGHT",
  "CAMERA_PITCH_UP",
  "CAMERA_PITCH_DOWN",
  "CAMERA_SCALE",
  "CAMERA_RETURN",
]);

export function analyzeCameraVerificationSession(
  entries: readonly SessionLogEntry[],
): CameraVerificationMetrics {
  const metadata = entries.find((entry) => entry.metadata)?.metadata;
  if (metadata?.sessionType !== "CAMERA") {
    throw new Error("camera verification requires a CAMERA session log");
  }
  const usableEntryCount = entries.filter((entry) => entry.cameraTransform && entry.cameraAssessment).length;
  if (usableEntryCount === 0) {
    throw new Error("camera verification log is missing transform/assessment fields; old logs are not supported");
  }

  const scenarios = makeScenarioResults(entries);
  const transformed = entries.map((entry) => entry.cameraTransform!).filter(Boolean);
  const nonNormal = entries.filter((entry) => entry.groundTruth !== "NORMAL_WORK");
  const falsePositiveCount = entries.filter(
    (entry) => entry.groundTruth === "NORMAL_WORK" && entry.cameraTransform &&
      (entry.cameraAssessment?.state === "ADJUSTED" || entry.cameraAssessment?.state === "RECALIBRATION_REQUIRED"),
  ).length;
  const unknownFrameCount = entries.filter((entry) => entry.cameraAssessment?.state === "UNKNOWN").length;
  const detectionDelays = scenarios
    .map((scenario) => scenario.detectionDelaySeconds)
    .filter((value): value is number => value !== null);
  const directionResults = scenarios.filter((scenario) => scenario.expectedDirection !== "none");
  const recoveredResults = scenarios.filter((scenario) => scenario.recovered !== null);
  return {
    sessionType: "CAMERA",
    frameCount: entries.length,
    scenarioCount: scenarios.length,
    detectedScenarioCount: detectionDelays.length,
    detectionRate: ratio(detectionDelays.length, scenarios.length),
    falsePositiveCount,
    falsePositiveRate: ratio(falsePositiveCount, Math.max(1, entries.length - nonNormal.length)),
    unknownFrameCount,
    unknownRate: ratio(unknownFrameCount, entries.length),
    averageDetectionDelaySeconds: average(detectionDelays),
    averageTrackedPointCount: average(transformed.map((value) => value.trackedPointCount)) ?? 0,
    averageInlierRatio: average(transformed.map((value) => value.inlierRatio)) ?? 0,
    averageReprojectionError: average(transformed.map((value) => value.reprojectionError)) ?? 0,
    directionAccuracy: directionResults.length > 0
      ? ratio(directionResults.filter((scenario) => scenario.expectedDirection === scenario.observedDirection).length, directionResults.length)
      : null,
    recoveryRate: recoveredResults.length > 0
      ? ratio(recoveredResults.filter((scenario) => scenario.recovered).length, recoveredResults.length)
      : null,
    scenarios,
    notes: [
      "Camera verification only accepts newly recorded CAMERA logs with transform and assessment fields.",
      "A camera angle change is measured from background features; posture landmarks are not used as the camera-change signal.",
      "Direction uses the median of reliable frames from CHANGE_ONSET through stabilization; UNKNOWN and low-quality frames are excluded.",
    ],
  };
}

export function formatCameraVerificationMetrics(report: CameraVerificationMetrics): string {
  return [
    `frames: ${report.frameCount}`,
    `scenarios detected: ${report.detectedScenarioCount}/${report.scenarioCount} (${percent(report.detectionRate)})`,
    `normal false positives: ${report.falsePositiveCount} (${percent(report.falsePositiveRate)})`,
    `unknown frames: ${report.unknownFrameCount} (${percent(report.unknownRate)})`,
    `average detection delay: ${report.averageDetectionDelaySeconds === null ? "n/a" : `${report.averageDetectionDelaySeconds.toFixed(2)}s`}`,
    `tracked points: ${report.averageTrackedPointCount.toFixed(1)}`,
    `inlier ratio: ${percent(report.averageInlierRatio)}`,
    `reprojection error: ${report.averageReprojectionError.toFixed(2)}px`,
    `direction accuracy: ${report.directionAccuracy === null ? "n/a" : percent(report.directionAccuracy)}`,
    `recovery rate: ${report.recoveryRate === null ? "n/a" : percent(report.recoveryRate)}`,
    "",
    ...report.scenarios.map((scenario) =>
      `${scenario.label}: detected=${scenario.detectedAt === null ? "no" : "yes"}, ` +
      `delay=${scenario.detectionDelaySeconds === null ? "n/a" : `${scenario.detectionDelaySeconds.toFixed(2)}s`}, ` +
      `direction=${scenario.observedDirection}`,
    ),
    "",
    ...report.notes,
  ].join("\n");
}

function makeScenarioResults(
  entries: readonly SessionLogEntry[],
): CameraScenarioResult[] {
  const starts = entries.flatMap((entry) =>
    (entry.markers ?? [])
      .filter((marker) => marker.type === "SCENARIO_STARTED" && CAMERA_LABELS.has(marker.label))
      .map((marker) => marker),
  );
  return starts
    .filter((marker) => marker.label !== "CAMERA_RETURN")
    .map((marker) => {
      const changeOnset = entries
        .flatMap((entry) => entry.markers ?? [])
        .find(
          (candidate) =>
            candidate.type === "CHANGE_ONSET" &&
            candidate.label === marker.label &&
            candidate.timestamp >= marker.timestamp,
        );
      const measurementStart = changeOnset?.timestamp ?? marker.timestamp;
      const endMarker = entries
        .flatMap((entry) => entry.markers ?? [])
        .find((candidate) => candidate.type === "SCENARIO_ENDED" && candidate.timestamp >= marker.timestamp);
      const end = endMarker?.timestamp ?? Number.POSITIVE_INFINITY;
      const segment = entries.filter((entry) => entry.timestamp >= measurementStart && entry.timestamp <= end);
      const reliableSegment = segment.filter(isReliableCameraFrame);
      const unknownFrameCount = segment.filter((entry) => entry.cameraAssessment?.state === "UNKNOWN").length;
      const stateDetected = segment.find(
        (entry) => entry.cameraAssessment?.state === "ADJUSTED" ||
          entry.cameraAssessment?.state === "RECALIBRATION_REQUIRED",
      );
      const cumulativeDetected = findCumulativeDetection(reliableSegment, marker.label);
      const detected = firstEntry(stateDetected, cumulativeDetected);
      const directionWindow = reliableSegment.filter(
        (entry) => entry.timestamp <= (detected?.timestamp ?? measurementStart + 2000),
      );
      const transform = aggregateEpisodeTransform(directionWindow);
      const expectedDirection = expectedDirectionFor(marker.label);
      const observedDirection = transform ? observedDirectionFor(transform, marker.label) : "none";
      const recovery = segment.length > 0
        ? segment.some((entry) => entry.cameraAssessment?.state === "VALID" && entry.timestamp > measurementStart + 1000)
        : null;
      return {
        label: marker.label,
        startedAt: measurementStart,
        detectedAt: detected?.timestamp ?? null,
        detectionDelaySeconds: detected ? (detected.timestamp - measurementStart) / 1000 : null,
        expectedDirection,
        observedDirection,
        recovered: recovery,
        reliableFrameCount: reliableSegment.length,
        unknownFrameCount,
      };
    });
}

function isReliableCameraFrame(entry: SessionLogEntry): boolean {
  const transform = entry.cameraTransform;
  return Boolean(
    transform &&
      transform.trackedPointCount >= 6 &&
      transform.confidence >= 0.45 &&
      transform.inlierRatio >= 0.45 &&
      transform.reprojectionError <= 3,
  );
}

function firstEntry(
  left: SessionLogEntry | undefined,
  right: SessionLogEntry | undefined,
): SessionLogEntry | undefined {
  if (!left) return right;
  if (!right) return left;
  return left.timestamp <= right.timestamp ? left : right;
}

function findCumulativeDetection(
  entries: readonly SessionLogEntry[],
  label: ScenarioLabel["label"],
): SessionLogEntry | undefined {
  let translationX = 0;
  let translationY = 0;
  let scale = 0;
  let roll = 0;
  let yaw = 0;
  let pitch = 0;
  let consecutive = 0;
  for (const entry of entries) {
    const transform = entry.cameraTransform;
    if (!transform) continue;
    translationX += transform.translationX;
    translationY += transform.translationY;
    scale += transform.scale;
    roll += transform.roll;
    yaw += transform.yawProxy ?? 0;
    pitch += transform.pitchProxy ?? 0;
    const exceeded = exceedsScenarioThreshold(label, {
      translationX,
      translationY,
      scale,
      roll,
      yaw,
      pitch,
    });
    consecutive = exceeded ? consecutive + 1 : 0;
    if (consecutive >= 3) return entry;
  }
  return undefined;
}

function exceedsScenarioThreshold(
  label: ScenarioLabel["label"],
  value: { translationX: number; translationY: number; scale: number; roll: number; yaw: number; pitch: number },
): boolean {
  if (label === "CAMERA_TRANSLATION_X") return Math.abs(value.translationX) >= 0.035;
  if (label === "CAMERA_TRANSLATION_Y") return Math.abs(value.translationY) >= 0.035;
  if (label === "CAMERA_ROLL") return Math.abs(value.roll) >= 0.05;
  if (label === "CAMERA_YAW_LEFT" || label === "CAMERA_YAW_RIGHT") return Math.abs(value.yaw) >= 0.02;
  if (label === "CAMERA_PITCH_UP" || label === "CAMERA_PITCH_DOWN") return Math.abs(value.pitch) >= 0.02 || Math.abs(value.translationY) >= 0.035;
  if (label === "CAMERA_SCALE") return Math.abs(value.scale) >= 0.06;
  return false;
}

function aggregateTransforms(entries: readonly SessionLogEntry[]): CameraTransform | null {
  const transforms = entries
    .map((entry) => entry.cameraTransform)
    .filter((transform): transform is CameraTransform => Boolean(transform));
  if (transforms.length === 0) return null;
  return {
    ...transforms[0],
    timestamp: transforms[0].timestamp,
    translationX: median(transforms.map((transform) => transform.translationX)),
    translationY: median(transforms.map((transform) => transform.translationY)),
    scale: median(transforms.map((transform) => transform.scale)),
    roll: median(transforms.map((transform) => transform.roll)),
    ...(hasOptionalValues(transforms, "yawProxy")
      ? { yawProxy: median(transforms.map((transform) => transform.yawProxy ?? 0)) }
      : {}),
    ...(hasOptionalValues(transforms, "pitchProxy")
      ? { pitchProxy: median(transforms.map((transform) => transform.pitchProxy ?? 0)) }
      : {}),
  };
}

function aggregateEpisodeTransform(entries: readonly SessionLogEntry[]): CameraTransform | null {
  const aggregate = aggregateTransforms(entries);
  if (!aggregate) return null;
  const transforms = entries
    .map((entry) => entry.cameraTransform)
    .filter((transform): transform is CameraTransform => Boolean(transform));
  return {
    ...aggregate,
    translationX: transforms.reduce((sum, transform) => sum + transform.translationX, 0),
    translationY: transforms.reduce((sum, transform) => sum + transform.translationY, 0),
    scale: transforms.reduce((sum, transform) => sum + transform.scale, 0),
    roll: transforms.reduce((sum, transform) => sum + transform.roll, 0),
  };
}

function hasOptionalValues(
  transforms: readonly CameraTransform[],
  key: "yawProxy" | "pitchProxy",
): boolean {
  return transforms.some((transform) => transform[key] !== undefined);
}

function expectedDirectionFor(label: ScenarioLabel["label"]): string {
  if (label === "CAMERA_TRANSLATION_X") return "x";
  if (label === "CAMERA_TRANSLATION_Y" || label === "CAMERA_PITCH_UP" || label === "CAMERA_PITCH_DOWN") return "y";
  if (label === "CAMERA_ROLL") return "roll";
  if (label === "CAMERA_YAW_LEFT" || label === "CAMERA_YAW_RIGHT") return "yaw";
  if (label === "CAMERA_SCALE") return "scale";
  return "none";
}

function observedDirectionFor(transform: CameraTransform, label: ScenarioLabel["label"]): string {
  const direction = expectedDirectionFor(label);
  if (direction === "x") return Math.abs(transform.translationX) > Math.abs(transform.translationY) ? "x" : "other";
  if (direction === "y") return Math.abs(transform.translationY) > Math.abs(transform.translationX) ? "y" : "other";
  if (direction === "roll") return Math.abs(transform.roll) > 0.03 ? "roll" : "other";
  if (direction === "yaw") {
    return Math.abs(transform.yawProxy ?? transform.translationX) > 0.01 ? "yaw" : "other";
  }
  if (direction === "scale") return Math.abs(transform.scale) > 0.03 ? "scale" : "other";
  return "none";
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
