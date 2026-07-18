# B Structure: Profile Baseline

## Role

B owns the profile and baseline detection layer.

The main responsibility is to receive `FrameFeature` values from A, build a
personal reference profile, compare new frames against that reference, and
provide drift-related output that C can consume later.

```text
FrameFeature[]
  -> UserProfile
  -> V0 fixed-threshold decision
  -> DriftObservation / DetectionEvent
```

## Related Files

```text
src/core/profile-builder/index.ts
src/core/fixed-threshold-detector/index.ts
src/web/indexeddb-storage/index.ts
src/core/types.ts
```

## Implemented

### `buildUserProfile`

File: `src/core/profile-builder/index.ts`

This function builds a Day 1 calibration profile from mock or real
`FrameFeature[]` input.

Current behavior:

- Uses only frames with `confidence >= 0.8`.
- Calculates average centers for:
  - `shoulderTilt`
  - `headXOffset`
  - `headYOffset`
  - `bodyScale`
- Stores those averages in `originalCenters`.
- Initializes `adaptiveCenters` with the same values as `originalCenters`.
- Initializes `featureDeviations` as `0` for Day 1.
- Records `calibrationDuration` and `validFrameCount`.

Meaning of profile fields:

- `originalCenters`: first calibration reference posture.
- `adaptiveCenters`: adjustable reference posture used in later versions.
- `featureDeviations`: normal per-feature variation, to be improved in V1.
- `calibrationDuration`: time range covered by valid calibration frames.
- `validFrameCount`: number of frames actually used for the profile.

### `evaluateV0`

File: `src/core/fixed-threshold-detector/index.ts`

This function implements the Day 1 fixed-threshold baseline.

Current behavior:

- Compares the current `FrameFeature` against calibration reference centers.
- Adds a reason when a feature exceeds its threshold:
  - `shoulderTilt`
  - `headXOffset`
  - `headYOffset`
  - `bodyScale`
  - `torsoLean`, only when present
- Returns `state: "BAD"` and `alert: true` if at least one feature exceeds a
  threshold.
- Returns `state: "STABLE"` and `alert: false` when no feature exceeds a
  threshold.

### `FixedThresholdDetector`

File: `src/core/fixed-threshold-detector/index.ts`

This class completes the Day 2 V0 behavior by tracking how long the current
frame has remained in a BAD candidate state.

Current behavior:

- Uses `evaluateV0` to classify each frame as `STABLE` or `BAD`.
- Starts a BAD timer when the first BAD frame appears.
- Keeps `alert: false` while BAD has lasted for less than
  `sustainedSeconds`.
- Emits `alert: true` once BAD lasts for at least `sustainedSeconds`.
- Resets the BAD timer when a stable frame arrives.
- Provides `reset()` for replay/evaluation sessions.

Default sustained threshold:

```ts
sustainedSeconds: 1.5
```

Expected usage:

```ts
const detector = new FixedThresholdDetector(profile.originalCenters);
const event = detector.update(frame);
```

### Profile baseline demo

File: `src/core/profile-baseline-demo.ts`

This file provides a small mock flow for checking B's Day 1 implementation.

```text
stableCalibrationFrames
  -> buildUserProfile()
  -> evaluateV0(stableCheckFrame)
  -> evaluateV0(driftCheckFrame)
```

Expected result:

- `stableResult`: `state: "STABLE"`, `alert: false`, `reason: []`
- `driftResult`: `state: "BAD"`, `alert: true`, with exceeded feature names in
  `reason`

### IndexedDB profile storage

File: `src/web/indexeddb-storage/index.ts`

This module stores and loads B's calibration output in the browser.

Current behavior:

- Opens the `posture-core` IndexedDB database.
- Creates a `profiles` object store when the database is first initialized.
- Saves one default profile bundle with key `"default"`.
- Loads that default profile bundle, returning `null` when nothing is saved yet.

Stored shape:

```ts
{
  userProfile,
  cameraProfile,
  lastCalibrationAt
}
```

## Next Work

1. Connect `FixedThresholdDetector` to C's replay evaluator path.
2. Tune V0 threshold candidates with short development-session logs.
3. Keep `npm run lint`, `npm run typecheck`, `npm run test`, and
   `npm run build` passing.

## Day 1 Completion Target

```text
sample FrameFeature[]
  -> buildUserProfile()
  -> evaluateV0()
  -> readable result in console or tests
```
