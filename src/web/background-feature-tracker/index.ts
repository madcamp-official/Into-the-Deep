import type { CameraTransform } from "../../core/types";

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

const DEFAULT_OPTIONS: Required<BackgroundFeatureTrackerOptions> = {
  width: 320,
  height: 180,
  patchRadius: 3,
  searchRadius: 12,
  minMatchScore: 0.82,
};

// Tracks small background patches at several fixed locations. Unlike a single
// brightness sample, matching preserves direction and supports a robust
// similarity transform estimate while the user's body is moving.
export class BackgroundFeatureTracker {
  private readonly options: Required<BackgroundFeatureTrackerOptions>;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private previous: Float32Array | null = null;
  private previousPoints: Point[] = [];

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
    const confidence = clamp(
      (matches.length / points.length) * transform.inlierRatio *
        (1 - Math.min(transform.reprojectionError / 12, 1)),
      0,
      1,
    );
    return {
      timestamp,
      ...transform,
      trackedPointCount: matches.length,
      confidence,
      source: "BACKGROUND_FEATURES",
    };
  }
}

function createPoints(width: number, height: number): Point[] {
  const points: Point[] = [];
  for (const y of [0.12, 0.28, 0.72, 0.88]) {
    for (const x of [0.08, 0.2, 0.35, 0.65, 0.8, 0.92]) {
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
  const dx = median(matches.map((match) => match.to.x - match.from.x));
  const dy = median(matches.map((match) => match.to.y - match.from.y));
  const center = {
    x: median(matches.map((match) => match.from.x)),
    y: median(matches.map((match) => match.from.y)),
  };
  const scales = matches.map((match) => {
    const before = distance(match.from, center);
    const after = distance(match.to, { x: center.x + dx, y: center.y + dy });
    return before > 1 ? after / before : 1;
  });
  const rolls = matches.map((match) => {
    const before = Math.atan2(match.from.y - center.y, match.from.x - center.x);
    const after = Math.atan2(match.to.y - center.y - dy, match.to.x - center.x - dx);
    return normalizeAngle(after - before);
  });
  const scale = median(scales);
  const roll = median(rolls);
  const horizontalDisplacements = matches.map((match) => match.to.x - match.from.x - dx);
  const verticalDisplacements = matches.map((match) => match.to.y - match.from.y - dy);
  const yawProxy = linearSlope(matches.map((match) => match.from.x), horizontalDisplacements) / 320;
  const pitchProxy = linearSlope(matches.map((match) => match.from.y), verticalDisplacements) / 180;
  const errors = matches.map((match) => {
    const predicted = {
      x: center.x + dx + (match.from.x - center.x) * scale,
      y: center.y + dy + (match.from.y - center.y) * scale,
    };
    return distance(predicted, match.to);
  });
  const error = median(errors);
  const inlierRatio = errors.filter((value) => value <= Math.max(4, error * 2)).length / matches.length;
  return {
    translationX: dx / 320,
    translationY: dy / 180,
    scale: scale - 1,
    roll,
    yawProxy,
    pitchProxy,
    inlierRatio,
    reprojectionError: error,
  };
}

function linearSlope(values: number[], outputs: number[]): number {
  const meanValue = values.reduce((sum, value) => sum + value, 0) / values.length;
  const meanOutput = outputs.reduce((sum, value) => sum + value, 0) / outputs.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < values.length; index += 1) {
    const valueDelta = values[index] - meanValue;
    numerator += valueDelta * (outputs[index] - meanOutput);
    denominator += valueDelta * valueDelta;
  }
  return denominator > 0 ? numerator / denominator : 0;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function distance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function normalizeAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
