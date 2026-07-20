import type {
  CameraProfile,
  FrameFeature,
  MADProfile,
  ScenarioLabel,
  UserProfile,
} from "../../core/types";

export type SessionType = "POSTURE" | "CAMERA";

export type SessionMarkerType =
  | "SCENARIO_STARTED"
  | "DRIFT_ONSET"
  | "SCENARIO_ENDED";

export interface SessionMarker {
  timestamp: number;
  type: SessionMarkerType;
  label: ScenarioLabel["label"];
}

export interface SessionMetadata {
  userProfile: UserProfile;
  cameraProfile: CameraProfile;
  madProfile?: MADProfile;
  profileCreatedAt: number;
  sessionType?: SessionType;
}

// Mirrors the sample-data/sample-session.jsonl schema (plan.md section 19).
export interface SessionLogEntry {
  timestamp: number;
  // Stored on the first frame only to keep the existing frame-oriented JSONL
  // format while making each session replayable with its calibration snapshot.
  metadata?: SessionMetadata;
  groundTruth: ScenarioLabel["label"];
  cameraState: string;
  confidence: number;
  features: Omit<FrameFeature, "timestamp" | "confidence">;
  markers?: SessionMarker[];
}

// Day2 recording start/stop (plan.md section 19). Buffers frames in memory
// while recording is on; callers decide when/how to persist getEntries().
export class SessionRecorder {
  private entries: SessionLogEntry[] = [];
  private recording = false;
  private pendingMarkers: SessionMarker[] = [];
  private metadata: SessionMetadata | undefined;

  start(metadata?: SessionMetadata): void {
    this.recording = true;
    this.entries = [];
    this.pendingMarkers = [];
    this.metadata = metadata;
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
    this.metadata = undefined;
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

    const features = Object.fromEntries(
      Object.entries(feature).filter(([key]) => key !== "timestamp" && key !== "confidence"),
    ) as Omit<FrameFeature, "timestamp" | "confidence">;
    const entry: SessionLogEntry = {
      timestamp: feature.timestamp,
      ...(this.entries.length === 0 && this.metadata
        ? { metadata: this.metadata }
        : {}),
      groundTruth,
      cameraState,
      confidence: feature.confidence,
      features,
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

export function getSessionMetadata(
  entries: readonly SessionLogEntry[],
): SessionMetadata | undefined {
  return entries.find((entry) => entry.metadata)?.metadata;
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
              marker.label === "CLOSE_TO_CAMERA" ||
              marker.label === "HEAD_TILT" ||
              marker.label === "CHIN_REST" ||
              marker.label === "HEAD_BACK" ||
              marker.label === "SHOULDER_ASYMMETRY" ||
              marker.label === "ROUNDED_SHOULDERS" ||
              marker.label === "BACKWARD_LEAN" ||
              marker.label === "CHIN_TUCK" ||
              marker.label === "TORSO_TWIST" ||
              marker.label === "SHOULDERS_ONLY_TWIST"
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
