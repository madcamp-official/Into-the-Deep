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
- Keeps `sustainedSeconds` in the config for V0 completion, but Day 1 currently
  evaluates a single frame only.

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

## Next Work

1. Implement IndexedDB profile save/load draft in
   `src/web/indexeddb-storage/index.ts`.
2. Keep `npm run lint`, `npm run typecheck`, and `npm run build` passing.

## Day 1 Completion Target

```text
sample FrameFeature[]
  -> buildUserProfile()
  -> evaluateV0()
  -> readable result in console or tests
```
