import type { FrameFeature, ScenarioLabel } from "../../core/types";

// Mirrors the sample-data/sample-session.jsonl schema (plan.md section 19).
export interface SessionLogEntry {
  timestamp: number;
  groundTruth: ScenarioLabel["label"];
  cameraState: string;
  confidence: number;
  features: {
    shoulderTilt: number;
    headXOffset: number;
    shoulderXOffset: number;
    shoulderYOffset: number;
    bodyScale: number;
    motionEnergy: number;
    torsoLean?: number;
  };
}

// Day2 recording start/stop (plan.md section 19). Buffers frames in memory
// while recording is on; callers decide when/how to persist getEntries().
export class SessionRecorder {
  private entries: SessionLogEntry[] = [];
  private recording = false;

  start(): void {
    this.recording = true;
    this.entries = [];
  }

  stop(): readonly SessionLogEntry[] {
    this.recording = false;
    return this.entries;
  }

  isRecording(): boolean {
    return this.recording;
  }

  record(
    feature: FrameFeature,
    groundTruth: ScenarioLabel["label"],
    cameraState: string,
  ): void {
    if (!this.recording) return;

    this.entries.push({
      timestamp: feature.timestamp,
      groundTruth,
      cameraState,
      confidence: feature.confidence,
      features: {
        shoulderTilt: feature.shoulderTilt,
        headXOffset: feature.headXOffset,
        shoulderXOffset: feature.shoulderXOffset,
        shoulderYOffset: feature.shoulderYOffset,
        bodyScale: feature.bodyScale,
        motionEnergy: feature.motionEnergy,
        ...(feature.torsoLean !== undefined ? { torsoLean: feature.torsoLean } : {}),
      },
    });
  }

  getEntries(): readonly SessionLogEntry[] {
    return this.entries;
  }
}

export function toJSONL(entries: readonly SessionLogEntry[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n");
}

export function parseJSONL(text: string): SessionLogEntry[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as SessionLogEntry);
}
