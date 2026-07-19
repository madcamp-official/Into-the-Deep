import type { FrameFeature, ScenarioLabel } from "../../core/types";

export type SessionMarkerType =
  | "SCENARIO_STARTED"
  | "DRIFT_ONSET"
  | "SCENARIO_ENDED";

export interface SessionMarker {
  timestamp: number;
  type: SessionMarkerType;
  label: ScenarioLabel["label"];
}

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
    faceToShoulderRatio?: number;
    pitchProxy?: number;
    yawProxy?: number;
    motionEnergy: number;
  };
  markers?: SessionMarker[];
}

// Day2 recording start/stop (plan.md section 19). Buffers frames in memory
// while recording is on; callers decide when/how to persist getEntries().
export class SessionRecorder {
  private entries: SessionLogEntry[] = [];
  private recording = false;
  private pendingMarkers: SessionMarker[] = [];

  start(): void {
    this.recording = true;
    this.entries = [];
    this.pendingMarkers = [];
  }

  stop(): readonly SessionLogEntry[] {
    this.recording = false;
    if (this.pendingMarkers.length > 0 && this.entries.length > 0) {
      this.entries[this.entries.length - 1].markers = [
        ...(this.entries[this.entries.length - 1].markers ?? []),
        ...this.pendingMarkers,
      ];
    }
    this.pendingMarkers = [];
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

    const entry: SessionLogEntry = {
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
        ...(feature.faceToShoulderRatio !== undefined
          ? { faceToShoulderRatio: feature.faceToShoulderRatio }
          : {}),
        ...(feature.pitchProxy !== undefined ? { pitchProxy: feature.pitchProxy } : {}),
        ...(feature.yawProxy !== undefined ? { yawProxy: feature.yawProxy } : {}),
        motionEnergy: feature.motionEnergy,
      },
    };

    if (this.pendingMarkers.length > 0) {
      entry.markers = this.pendingMarkers;
      this.pendingMarkers = [];
    }

    this.entries.push(entry);
  }

  mark(marker: SessionMarker): void {
    if (!this.recording) return;
    this.pendingMarkers.push(marker);
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

export function labelsFromEntries(
  entries: readonly SessionLogEntry[],
): ScenarioLabel[] {
  const labels: ScenarioLabel[] = [];

  for (const entry of entries) {
    for (const marker of entry.markers ?? []) {
      if (marker.type === "SCENARIO_STARTED") {
        labels.push({
          timestamp: marker.timestamp,
          label: marker.label === "FORWARD_LEAN" ||
              marker.label === "FORWARD_HEAD" ||
              marker.label === "LEFT_LEAN" ||
              marker.label === "RIGHT_LEAN" ||
              marker.label === "SIDE_SHIFT" ||
              marker.label === "HEAD_TURN" ||
              marker.label === "CLOSE_TO_CAMERA"
            ? "SETTLING"
            : marker.label,
        });
      } else if (marker.type === "DRIFT_ONSET") {
        labels.push({ timestamp: marker.timestamp, label: marker.label });
      } else if (marker.type === "SCENARIO_ENDED") {
        labels.push({ timestamp: marker.timestamp, label: "NORMAL_WORK" });
      }
    }
  }

  if (labels.length > 0) {
    return labels.sort((left, right) => left.timestamp - right.timestamp);
  }

  let previousLabel: ScenarioLabel["label"] | null = null;
  for (const entry of entries) {
    if (entry.groundTruth !== previousLabel) {
      labels.push({ timestamp: entry.timestamp, label: entry.groundTruth });
      previousLabel = entry.groundTruth;
    }
  }

  return labels;
}
