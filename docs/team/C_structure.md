# C Structure: Recording, Replay, Evaluation

## Role

C owns the evaluation layer: recording sessions, replaying stored logs
through any detector version, and scoring the result.

```text
FrameFeature[] (recorded live)
  -> SessionLogEntry[] (JSONL)
  -> replay through V0 and/or V1
  -> DetectionEvent[]
  -> MetricsReport (compared against ScenarioLabel[] ground truth)
```

## Related Files

```text
src/evaluation/recorder/index.ts
src/evaluation/scenario-labeler/index.ts
src/evaluation/replay-evaluator/index.ts
src/evaluation/metrics/index.ts
src/evaluation/v0-v1-comparison.ts
src/evaluation/replay-demo.ts
```

## Implemented

### `replay-evaluator`: `createV0Detector` / `createV1Detector`

File: `src/evaluation/replay-evaluator/index.ts`

Both wrap a stateful detector (B's `FixedThresholdDetector` /
`PersonalizedDriftDetector`) as a `Detector` function so the same
`SessionLogEntry[]` can be replayed through either version and produce a
directly comparable `DetectionEvent[]`. `createV1Detector` needs a full
`UserProfile` (not just reference centers), since V1's scoring depends on
`adaptiveCenters` and the per-feature MAD in `featureDeviations`.

### `v0-v1-comparison`: `compareV0AndV1` / `formatComparisonTable`

File: `src/evaluation/v0-v1-comparison.ts`

Implements the Day 3 completion target from `docs/planning/plan.md` section 23
("저장된 로그에서 V0/V1 비교 가능", "V0·V1 replay 비교 스크립트를 CI에서도
동일하게 실행되도록 연결"):

- `compareV0AndV1(entries, profile, groundTruth)` replays the same log
  through both detectors and returns `computeMetrics` output for each.
- `formatComparisonTable(result)` renders the three official/aux metrics
  as a plain-text table.
- The comparison itself runs as a Vitest suite
  (`src/evaluation/v0-v1-comparison.test.ts`), so `npm run test` exercises
  it on every push/PR exactly like any other unit test — that's what
  "실행되도록 연결" means here, rather than a separate one-off script.
- `buildProfileFromNormalWork(entries)` is a fallback for replaying a real
  downloaded session that wasn't saved alongside its calibration profile
  (the live app doesn't export one yet). It self-calibrates from the
  log's own `NORMAL_WORK` frames. Prefer passing a profile from a real
  calibration when one is available — self-calibrating from the same log
  folds any false-positive segments into the reference centers/MAD,
  which can mask exactly the problem you're trying to measure.

### Metrics fix: millisecond timestamps

File: `src/evaluation/metrics/index.ts`

`computeMetrics`'s drift-detection window and false-alerts-per-hour
calculation were still written as if `ScenarioLabel`/`DetectionEvent`
timestamps were in seconds. Once the rest of the codebase moved to
milliseconds (matching `performance.now()`), this silently broke:

- The 10-second detection window became a ~10-**millisecond** window, so
  almost no real detection (which naturally lands 1-3s after drift onset
  once the sustained-alert gate clears) was ever credited —
  `sustainedDriftDetectionRate` read `0` even when the detector worked.
- `falseAlertsPerHour` divided a millisecond duration by 3600, understating
  the rate by ~1000x.

Both are fixed by converting the ms difference to seconds before
comparing/reporting. Covered by `src/evaluation/metrics/index.test.ts`.

## 실패 사례 (V1 failure cases found during Day 3)

### Sustained sideways glance is not exempted (open)

Scenario: user turns to talk to a neighbor for several seconds during
otherwise-normal work. Ground truth: `NORMAL_WORK` (not bad posture).

- **V0**: `yawProxy` was added as a plain absolute-threshold signal (see
  `docs/B_structure.md`), so this reliably fires — by design, V0 is meant
  to be maximally strict (`docs/planning/plan.md`'s "(a) 기준 중 하나라도 벗어나면 바로
  지적" approach) and over-collects false positives on purpose.
- **V1**: not fixed by personalization alone. `PersonalizedDriftDetector`
  includes `yawProxy` in its weighted deviation score with no contextual
  exception, so a sustained turn still crosses `driftScore >= 3` the same
  way V0's fixed threshold does.

`src/evaluation/v0-v1-comparison.test.ts`'s
`"neither V0 nor V1 currently exempt a sustained sideways glance"` test
encodes this as a running regression check — flip its assertions once V1
adds a "yaw-dominant drift is not necessarily bad" rule, per the team's
plan to solve this in V1/V2 rather than in V0.

Example run (synthetic session: 5s of forward-facing calibration, then a
sustained sideways glance during `NORMAL_WORK`, then a real
`FORWARD_LEAN` drift):

```text
| metric                         | V0     | V1     |
| ------------------------------- | ------ | ------ |
| false alerts / hour            | 327.27 | 327.27 |
| sustained drift detection rate | 100%   | 100%   |
| avg detection delay (s)        | 2.00   | 2.00   |
```

Note V0 and V1 report identical numbers here — with the tight, low-variance
calibration used in this fixture, V1's per-feature MAD floors dominate the
normalization, so it behaves almost like a fixed threshold. Whether V1
diverges from V0 on real, noisier calibration data (and whether it
actually improves precision once a real dev session is recorded) is still
open — see "Next Work".

### `compareV1ThresholdCandidates` / `formatThresholdSweepTable`

File: `src/evaluation/v0-v1-comparison.ts`

B owns `core/personalized-detector`'s `DEFAULT_PERSONALIZED_THRESHOLDS`
(currently `driftScore: 3`) and is tuning it directly against real
sessions. To give B measured numbers instead of duplicating that tuning
work, `compareV1ThresholdCandidates` replays one session once per
candidate `driftScore` cutoff (via `options` passed into `replay`,
without touching `personalized-detector` itself) and reports
`falseAlertsPerHour` / `sustainedDriftDetectionRate` / average delay for
each. `formatThresholdSweepTable` renders it as one row per candidate.

Example run (`buildGlanceAndForwardLeanSession(0.26)` from
`v0-v1-comparison.fixtures.ts` — a sideways glance tuned to sit right at
the decision boundary, plus the same real forward-lean drift):

```text
| driftScore >= | false alerts / hour | detection rate | avg delay (s) |
| ------------- | -------------------- | --------------- | -------------- |
| 2.0           | 327.27               | 100%            | 2.00           |
| 2.5           | 327.27               | 100%            | 2.00           |
| 3.0           | 327.27               | 100%            | 2.00           |
| 3.5           | 327.27               | 100%            | 2.00           |
| 4.0           | 327.27               | 100%            | 2.00           |
| 4.5           | 0.00                 | 100%            | 2.00           |
| 5.0           | 0.00                 | 100%            | 2.00           |
| 6.0           | 0.00                 | 100%            | 2.00           |
```

The real forward-lean drift (driftScore ~7 in this fixture) stays
detected across every candidate, while the glance (driftScore ~4) stops
counting as a false alert once the cutoff passes it — i.e. raising
`driftScore` past ~4 would silence this specific false-positive without
losing the real detection, at least for this fixture's severity levels.
This doesn't mean 4.5 is the right production value — real calibration
noise will shift where things land — but it shows the sweep tool
surfaces exactly the kind of before/after evidence B needs to pick a
value deliberately rather than by feel.

## Next Work

1. Once a real webcam session is recorded (see main.ts's Calibration /
   측정 시작-종료 / 로그 다운로드), replay it through `compareV0AndV1`
   using `buildProfileFromNormalWork` or a saved calibration profile, and
   compare against the synthetic numbers above.
2. Coordinate with B on adding a "yaw-dominant drift is not bad" exception
   to V1 (or defer it to V2's temporal state machine), then update the
   failure-case test above to assert the fix.
3. `scenario-labeler`/`SessionRecorder` still hardcode `NORMAL_WORK` as the
   only ground-truth label recorded live (see main.ts) — wiring the
   `ScenarioLabeler` into the app's UI would let real sessions produce
   `FORWARD_LEAN`/etc. segments instead of requiring hand-edited logs.
