import type { CameraTransform, CameraTransformSnapshot } from "../../core/types";

interface Point {
  x: number;
  y: number;
}

export interface BackgroundFeatureTrackerOptions {
  width?: number;
  height?: number;
  patchRadius?: number;
  searchRadius?: number;
  minMatchScore?: number;
}

export interface BackgroundReference {
  width: number;
  height: number;
  grayscale: number[];
}

const DEFAULT_OPTIONS: Required<BackgroundFeatureTrackerOptions> = {
  width: 320,
  height: 180,
  patchRadius: 4,
  searchRadius: 18,
  minMatchScore: 0.82,
};
const MIN_CONFIDENT_TRACKED_POINTS = 8;

// Tracks small background patches at several fixed locations. Unlike a single
// brightness sample, matching preserves direction and supports a robust
// similarity transform estimate while the user's body is moving.
export class BackgroundFeatureTracker {
  private readonly options: Required<BackgroundFeatureTrackerOptions>;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private previous: Float32Array | null = null;
  private previousPoints: Point[] = [];
  private anchor: Float32Array | null = null;
  private anchorPoints: Point[] = [];
  private anchorLastMotionAt = 0;
  private reference: Float32Array | null = null;

  constructor(options: BackgroundFeatureTrackerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.options.width;
    this.canvas.height = this.options.height;
    const context = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("background feature canvas is unavailable");
    this.context = context;
  }

  reset(): void {
    this.previous = null;
    this.previousPoints = [];
    this.anchor = null;
    this.anchorPoints = [];
    this.anchorLastMotionAt = 0;
  }

  captureReference(): BackgroundReference | null {
    return this.previous
      ? {
          width: this.options.width,
          height: this.options.height,
          grayscale: Array.from(this.previous),
        }
      : null;
  }

  setReference(reference: BackgroundReference | undefined): void {
    this.reference = reference &&
        reference.width === this.options.width &&
        reference.height === this.options.height
      ? Float32Array.from(reference.grayscale)
      : null;
  }

  compareReference(video: HTMLVideoElement, timestamp: number): CameraTransform | null {
    if (!this.reference || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    this.context.drawImage(video, 0, 0, this.options.width, this.options.height);
    const image = this.context.getImageData(0, 0, this.options.width, this.options.height);
    const current = toGray(image.data);
    const points = createPoints(this.options.width, this.options.height);
    // A camera that was repositioned while the page was closed can move a
    // background patch much farther than a one-frame motion. Startup-only
    // comparison can afford a wider search because it runs for a few seconds.
    const referenceOptions = {
      ...this.options,
      searchRadius: Math.max(this.options.searchRadius, 48),
    };
    const forwardMatches = points
      .map((point) => matchPatch(this.reference!, current, point, referenceOptions))
      .filter((match): match is { from: Point; to: Point; score: number } => match !== null);
    const matches = forwardMatches.filter((match) => {
      const reverse = matchPatch(current, this.reference!, match.to, referenceOptions);
      return reverse !== null && distance(reverse.to, match.from) <= 4;
    });
    if (matches.length < 4) return null;
    const estimate = estimateTransform(matches);
    const confidence = estimateTrackingConfidence(matches.length, estimate.inlierRatio, estimate.reprojectionError);
    return {
      timestamp,
      ...estimate,
      trackedPointCount: matches.length,
      confidence,
      source: "BACKGROUND_FEATURES",
    };
  }

  update(video: HTMLVideoElement, timestamp: number): CameraTransform | null {
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    this.context.drawImage(video, 0, 0, this.options.width, this.options.height);
    const image = this.context.getImageData(0, 0, this.options.width, this.options.height);
    const current = toGray(image.data);
    const points = this.previousPoints.length > 0
      ? this.previousPoints
      : createPoints(this.options.width, this.options.height);

    if (!this.previous) {
      this.previous = current;
      this.previousPoints = points;
      return null;
    }

    const previousFrame = this.previous;
    const previousPoints = this.previousPoints;
    const matches = points
      .map((point) => matchPatch(this.previous!, current, point, this.options))
      .filter((match): match is { from: Point; to: Point; score: number } => match !== null);
    this.previous = current;
    // Re-seed the grid after a weak frame instead of allowing the tracked
    // point set to shrink permanently after one occlusion or blur event.
    this.previousPoints = matches.length >= 8
      ? matches.map((match) => match.to)
      : createPoints(this.options.width, this.options.height);

    if (matches.length < 4) return null;
    const transform = estimateTransform(matches);
    const confidence = estimateTrackingConfidence(matches.length, transform.inlierRatio, transform.reprojectionError);
    const frameTransform: CameraTransform = {
      timestamp,
      ...transform,
      trackedPointCount: matches.length,
      confidence,
      source: "BACKGROUND_FEATURES",
    };
    const frameMotion = Math.abs(frameTransform.translationX) +
      Math.abs(frameTransform.translationY) +
      Math.abs(frameTransform.scale) +
      Math.abs(frameTransform.roll);
    if (!this.anchor && frameMotion >= 0.02 && previousFrame) {
      this.anchor = previousFrame;
      this.anchorPoints = previousPoints;
      this.anchorLastMotionAt = timestamp;
    }
    let keyframeTransform: CameraTransformSnapshot | undefined;
    if (this.anchor && this.anchorPoints.length >= 4) {
      const anchorMatches = this.anchorPoints
        .map((point) => matchPatch(this.anchor!, current, point, this.options))
        .filter((match): match is { from: Point; to: Point; score: number } => match !== null);
      if (anchorMatches.length >= 4) {
        const anchorEstimate = estimateTransform(anchorMatches);
        const anchorConfidence = estimateTrackingConfidence(
          anchorMatches.length,
          anchorEstimate.inlierRatio,
          anchorEstimate.reprojectionError,
        );
        keyframeTransform = {
          ...anchorEstimate,
          trackedPointCount: anchorMatches.length,
          confidence: anchorConfidence,
        };
        if (frameMotion >= 0.01) this.anchorLastMotionAt = timestamp;
      }
    }
    const result = keyframeTransform
      ? { ...frameTransform, keyframeTransform }
      : frameTransform;
    if (this.anchor && timestamp - this.anchorLastMotionAt > 1200) {
      this.anchor = null;
      this.anchorPoints = [];
      this.anchorLastMotionAt = 0;
    }
    return result;
  }
}

function createPoints(width: number, height: number): Point[] {
  const points: Point[] = [];
  // Use a 16-point perimeter grid. The inner image is deliberately avoided:
  // it commonly contains the user's face/torso, while the perimeter is more
  // likely to contain fixed background structure. Extra points let a few
  // patches disappear without making the affine estimate immediately weak.
  for (const y of [0.12, 0.88]) {
    for (const x of [0.1, 0.3, 0.7, 0.9]) {
      points.push({ x: width * x, y: height * y });
    }
  }
  for (const x of [0.1, 0.9]) {
    for (const y of [0.28, 0.5, 0.72, 0.82]) {
      points.push({ x: width * x, y: height * y });
    }
  }
  return points;
}

function toGray(data: Uint8ClampedArray): Float32Array {
  const gray = new Float32Array(data.length / 4);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    gray[index] = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
  }
  return gray;
}

function matchPatch(
  previous: Float32Array,
  current: Float32Array,
  point: Point,
  options: Required<BackgroundFeatureTrackerOptions>,
): { from: Point; to: Point; score: number } | null {
  const radius = options.patchRadius;
  const search = options.searchRadius;
  const width = options.width;
  const height = options.height;
  const source = readPatch(previous, point.x, point.y, width, height, radius);
  if (!source) return null;

  let best: { x: number; y: number; score: number } | null = null;
  for (let dy = -search; dy <= search; dy += 2) {
    for (let dx = -search; dx <= search; dx += 2) {
      const candidate = readPatch(current, point.x + dx, point.y + dy, width, height, radius);
      if (!candidate) continue;
      const score = patchScore(source, candidate);
      if (!best || score > best.score) best = { x: point.x + dx, y: point.y + dy, score };
    }
  }
  if (!best) return null;
  return best.score >= options.minMatchScore
    ? { from: point, to: { x: best.x, y: best.y }, score: best.score }
    : null;
}

function readPatch(
  image: Float32Array,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): number[] | null {
  const left = Math.round(x) - radius;
  const top = Math.round(y) - radius;
  if (left < 0 || top < 0 || left + radius * 2 >= width || top + radius * 2 >= height) return null;
  const values: number[] = [];
  for (let row = -radius; row <= radius; row += 1) {
    for (let column = -radius; column <= radius; column += 1) {
      values.push(image[(top + row) * width + left + column]);
    }
  }
  return values;
}

function patchScore(left: number[], right: number[]): number {
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftEnergy += leftDelta * leftDelta;
    rightEnergy += rightDelta * rightDelta;
  }
  if (leftEnergy === 0 || rightEnergy === 0) return 0;
  return (numerator / Math.sqrt(leftEnergy * rightEnergy) + 1) / 2;
}

function estimateTransform(matches: Array<{ from: Point; to: Point; score: number }>): Omit<CameraTransform, "timestamp" | "trackedPointCount" | "confidence" | "source"> {
  const consensus = findAffineConsensus(matches);
  const model = fitAffine(consensus.length >= 4 ? consensus : matches);
  const center = {
    x: median(matches.map((match) => match.from.x)),
    y: median(matches.map((match) => match.from.y)),
  };
  const predictedCenter = applyAffine(model, center);
  const translationX = (predictedCenter.x - center.x) / 320;
  const translationY = (predictedCenter.y - center.y) / 180;
  const determinant = model.a * model.e - model.b * model.d;
  const scale = Math.sqrt(Math.abs(determinant)) - 1;
  const roll = Math.atan2(model.d - model.b, model.a + model.e);
  const yawProxy = (model.a - 1) / 320;
  const pitchProxy = (model.e - 1) / 180;
  const errors = matches.map((match) => distance(applyAffine(model, match.from), match.to));
  const inlierThreshold = 6;
  const inliers = errors.filter((value) => value <= inlierThreshold);
  const error = median(inliers.length >= 4 ? inliers : errors);
  const inlierRatio = inliers.length / matches.length;
  return {
    translationX,
    translationY,
    scale,
    roll,
    yawProxy,
    pitchProxy,
    affine: model,
    inlierRatio,
    reprojectionError: error,
  };
}

function findAffineConsensus(matches: Array<{ from: Point; to: Point; score: number }>): Array<{ from: Point; to: Point; score: number }> {
  if (matches.length <= 3) return matches;
  let best: Array<{ from: Point; to: Point; score: number }> = [];
  let bestError = Number.POSITIVE_INFINITY;
  for (let first = 0; first < matches.length - 2; first += 1) {
    for (let second = first + 1; second < matches.length - 1; second += 1) {
      for (let third = second + 1; third < matches.length; third += 1) {
        const candidate = [matches[first], matches[second], matches[third]];
        const model = fitAffine(candidate);
        const inliers = matches.filter(
          (match) => distance(applyAffine(model, match.from), match.to) <= 6,
        );
        const candidateError = inliers.length > 0
          ? median(inliers.map((match) => distance(applyAffine(model, match.from), match.to)))
          : Number.POSITIVE_INFINITY;
        if (inliers.length > best.length ||
            (inliers.length === best.length && candidateError < bestError)) {
          best = inliers;
          bestError = candidateError;
        }
      }
    }
  }
  return best;
}

interface AffineModel {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

function fitAffine(matches: Array<{ from: Point; to: Point; score: number }>): AffineModel {
  const normal = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const rightX = [0, 0, 0];
  const rightY = [0, 0, 0];
  for (const match of matches) {
    const row = [match.from.x, match.from.y, 1];
    for (let rowIndex = 0; rowIndex < 3; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < 3; columnIndex += 1) {
        normal[rowIndex][columnIndex] += row[rowIndex] * row[columnIndex];
      }
      rightX[rowIndex] += row[rowIndex] * match.to.x;
      rightY[rowIndex] += row[rowIndex] * match.to.y;
    }
  }
  const x = solve3x3(normal, rightX);
  const y = solve3x3(normal, rightY);
  if (!x || !y) {
    return { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };
  }
  return { a: x[0], b: x[1], c: x[2], d: y[0], e: y[1], f: y[2] };
}

function solve3x3(matrix: number[][], values: number[]): [number, number, number] | null {
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let pivot = 0; pivot < 3; pivot += 1) {
    let bestRow = pivot;
    for (let row = pivot + 1; row < 3; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[bestRow][pivot])) bestRow = row;
    }
    if (Math.abs(augmented[bestRow][pivot]) < 1e-8) return null;
    [augmented[pivot], augmented[bestRow]] = [augmented[bestRow], augmented[pivot]];
    const divisor = augmented[pivot][pivot];
    for (let column = pivot; column < 4; column += 1) augmented[pivot][column] /= divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let column = pivot; column < 4; column += 1) {
        augmented[row][column] -= factor * augmented[pivot][column];
      }
    }
  }
  return [augmented[0][3], augmented[1][3], augmented[2][3]];
}

function applyAffine(model: AffineModel, point: Point): Point {
  return {
    x: model.a * point.x + model.b * point.y + model.c,
    y: model.d * point.x + model.e * point.y + model.f,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function distance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function estimateTrackingConfidence(
  trackedPointCount: number,
  inlierRatio: number,
  reprojectionError: number,
): number {
  // Eight well-distributed points are enough for our affine model. Do not
  // penalize confidence merely because additional perimeter points were
  // temporarily occluded; inlier quality and reprojection error remain the
  // stronger reliability signals.
  const coverage = Math.min(1, trackedPointCount / MIN_CONFIDENT_TRACKED_POINTS);
  return clamp(
    coverage * inlierRatio * (1 - Math.min(reprojectionError / 12, 1)),
    0,
    1,
  );
}
