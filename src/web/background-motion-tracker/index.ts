import type { MovementContext } from "../../core/types";

export interface BackgroundMotionSample {
  magnitude: number;
  confidence: number;
}

const SAMPLE_POINTS = [
  [0.08, 0.12],
  [0.92, 0.12],
  [0.08, 0.88],
  [0.92, 0.88],
  [0.18, 0.5],
  [0.82, 0.5],
] as const;

/** Samples scene edges, keeping the user's central body out of the signal. */
export class BackgroundMotionTracker {
  private readonly canvas = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D;
  private previous: number[] | null = null;

  constructor() {
    const context = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("background motion canvas is unavailable");
    this.context = context;
    this.canvas.width = 64;
    this.canvas.height = 36;
  }

  update(video: HTMLVideoElement): BackgroundMotionSample {
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      return { magnitude: 0, confidence: 0 };
    }

    this.context.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
    const pixels = this.context.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
    const values = SAMPLE_POINTS.map(([x, y]) => {
      const index = (Math.floor(y * this.canvas.height) * this.canvas.width + Math.floor(x * this.canvas.width)) * 4;
      return (pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114) / 255;
    });

    if (!this.previous) {
      this.previous = values;
      return { magnitude: 0, confidence: 1 };
    }

    const differences = values.map((value, index) => Math.abs(value - (this.previous?.[index] ?? value)));
    this.previous = values;
    const magnitude = differences.reduce((sum, value) => sum + value, 0) / differences.length;
    const stableSamples = differences.filter((value) => value < 0.2).length;
    return { magnitude, confidence: stableSamples / SAMPLE_POINTS.length };
  }

  reset(): void {
    this.previous = null;
  }
}

export function describeMovementContext(context: MovementContext): string {
  switch (context) {
    case "CAMERA_MOVEMENT": return "카메라 이동 의심";
    case "ARMREST_LEAN": return "팔걸이 기대기 의심";
    case "SIDE_SHIFT": return "상체 좌우 이동 의심";
    case "CHAIR_MOVEMENT": return "의자 이동 의심";
    case "UNKNOWN": return "움직임 구분 보류";
    default: return "움직임 없음";
  }
}
