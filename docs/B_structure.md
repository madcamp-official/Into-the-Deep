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
src/core/camera-profile/index.ts
src/core/fixed-threshold-detector/index.ts
src/core/personalized-detector/index.ts
src/web/indexeddb-storage/index.ts
src/core/types.ts
```

## Implemented

### `buildUserProfile`

File: `src/core/profile-builder/index.ts`

This function builds a calibration profile from mock or real
`FrameFeature[]` input.

Current behavior:

- Uses only frames with `confidence >= 0.8`.
- Calculates median centers and median absolute deviations (MAD) for:
  - `shoulderTilt`
  - `headXOffset`
  - `shoulderXOffset`
  - `shoulderYOffset`
  - `bodyScale`
  - `faceToShoulderRatio`, when available
  - `pitchProxy`, when available
  - `yawProxy`, when available
- Stores those medians in `originalCenters`.
- Initializes `adaptiveCenters` with the same values as `originalCenters`.
- Stores MAD values in `featureDeviations`.
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
  - `shoulderXOffset` (shoulder center left-right drift)
  - `shoulderYOffset` (shoulder center height/level drift; replaces the
    former `headYOffset` posture-height signal)
  - `bodyScale`
  - `forwardHead` (face-to-shoulder ratio increase plus pitch increase,
    only when body scale remains close to the calibration body scale)
  - `yawProxy` (head-turn asymmetry between the nose and both ears), only
    when present
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
- Interprets `FrameFeature.timestamp` as milliseconds, matching
  `performance.now()` in the browser runtime.
- Detects `forwardHead` when face-to-shoulder ratio increases by more than
  `0.025`, pitch proxy increases by more than `0.01`, and body scale stays
  within `30%` of the calibration body scale. These values were lowered after
  an initial manual session where forward-head movement changed
  `faceToShoulderRatio` from about `0.200` to `0.220` and `pitchProxy` from
  about `0.170` to `0.200`.

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
- The web app saves a new profile after successful calibration and restores a
  saved profile when it starts.

Stored shape:

```ts
{
  userProfile,
  cameraProfile,
  lastCalibrationAt
}
```

## Next Work

1. Tune V1's initial drift-score threshold using short development-session
   logs.
2. Record V0/V1 limitations found during manual camera sessions and replay.
3. Implement the Day 4 camera assessment states and recalibration branch.
4. Keep `npm run lint`, `npm run typecheck`, `npm run test`, and
   `npm run build` passing.

## Status

### Day 1

- Done: profile creation from sample `FrameFeature[]`.
- Done: single-frame V0 baseline decision.
- Done: browser IndexedDB save/load draft for profile storage.
- Done: mock profile baseline demo.

### Day 2

- Done: V0 sustained BAD tracking.
- Done: alert only after BAD lasts for `sustainedSeconds`.
- Done: reset sustained timer when posture returns to `STABLE`.
- Done: Vitest coverage for V0 single-frame behavior and sustained alert
  behavior.
- Done: replay evaluator V0 path uses `FixedThresholdDetector`, so stored
  JSONL replay follows the same sustained alert timing as the live app.

### Day 3

- Done: calibration centers now use the median instead of the mean.
- Done: `featureDeviations` stores per-feature MAD values.
- Done: V1 uses personalized normalized deviations for `shoulderTilt`,
  `headXOffset`, `shoulderXOffset`, `shoulderYOffset`,
  `faceToShoulderRatio`, `pitchProxy`, and `yawProxy`.
- Done: V1 drift score is the average of the two largest feature deviations.
- Done: V1 uses an initial score threshold of `3.0` and requires it to last
  for `1.5` seconds before alerting.
- Done: `bodyScale` is excluded from the V1 posture score until camera
  assessment is implemented.
- Done: adaptive profile updates remain disabled; the profile is only read
  by V1 and is not changed automatically.
- Done: calibration collects camera raw frames and creates a median-based
  `CameraProfile`.
- Done: successful calibration stores the `UserProfile`, `CameraProfile`,
  and calibration timestamp in IndexedDB under `"default"`.
- Done: the app restores that saved bundle when it starts.
- Done: the status panel displays camera shoulder-width and face-center
  deltas against the saved CameraProfile.

### `PersonalizedDriftDetector`

File: `src/core/personalized-detector/index.ts`

V1 compares each current feature with the user's adaptive center and divides
the absolute difference by that feature's MAD. The two largest normalized
differences are averaged as the `driftScore`, while their names become
`dominantFeatures`. Small per-feature minimum deviation floors prevent a
near-zero MAD from making normal landmark noise look like a large drift.

`yawProxy` is included as a candidate feature. It represents a sustained
head turn away from the calibration-facing direction; its usefulness and
false-alert rate should be checked with short development sessions.

Remaining Day 2 integration work:

- Use short development-session logs to review whether the current threshold
  candidates are too strict or too loose.
- Record known V0 limitations, especially short natural movements and camera
  changes that V0 cannot distinguish.

## Day 1 Completion Target

```text
sample FrameFeature[]
  -> buildUserProfile()
  -> evaluateV0()
  -> readable result in console or tests
```
