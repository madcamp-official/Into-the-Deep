# 협업 / Git 규칙

3명이 같은 코어를 병렬로 건드리는 프로젝트라, 충돌을 줄이려면 아래 규칙을 지켜주세요.
역할 분담 자체는 [plan.md](./plan.md) 22절 참고.

## 브랜치 구조 (2단계)

```
main
├── a   ← A의 통합 브랜치
│    ├── a/day1-vision-pipeline
│    ├── a/day2-landmark-reliability
│    └── ...
├── b   ← B의 통합 브랜치
│    ├── b/day1-profile-baseline
│    └── ...
└── c   ← C의 통합 브랜치
     ├── c/day1-temporal-evaluation
     └── ...
```

- `a`, `b`, `c`는 각자의 **장기 통합 브랜치**. main에서 파고, 오래 유지.
- 실제 작업은 `a`/`b`/`c`에서 바로 하지 않고, 그 밑에 **일차별 브랜치**를 새로 파서 진행: `a/day2-landmark-reliability`처럼 `<role>/dayN-<topic>` 형식.
- 일차별 브랜치는 끝나면 자기 role 브랜치(`a`/`b`/`c`)로 머지. main으로 바로 머지하지 않음.
- `a`/`b`/`c` → `main`은 매일 하는 게 아니라 **필요할 때** (다른 사람이 그 결과를 가져다 써야 하거나, 눈에 띄는 마일스톤을 찍었을 때) PR로 반영.
- 예전에 main 바로 밑에 파뒀던 `feature/a-vision-pipeline`, `feature/b-profile-baseline`, `feature/a-landmark-reliability`, `feature/c-temporal-evaluation`는 각각 `a`/`b`/`c`로 이미 머지해뒀습니다. 이 네 개는 더 안 쓰니 삭제해도 됩니다.

## 스텁(stub)이 뭔가요

실제 로직 없이 함수 시그니처와 타입만 만들어둔 뼈대 코드입니다 (`throw new Error("not implemented")`로 표시). 목적은 실제 데이터가 완성되기 전에 다른 사람이 mock 데이터로 병렬 개발을 시작할 수 있게 하는 것 — `plan.md`의 "병렬 진행을 위한 핵심 규칙" 참고.

## 담당 폴더 (충돌 방지용)

| 영역 | 담당 | 경로 |
| --- | --- | --- |
| A | 카메라/랜드마크/feature | `src/web/camera-adapter`, `src/web/canvas-overlay`, `src/core/landmark-reliability`, `src/core/feature-normalizer`, `src/core/camera-profile`(raw feature 계산만) |
| B | profile/score/camera 판정 | `src/core/profile-builder`, `src/core/fixed-threshold-detector`, `src/core/personalized-detector`, `src/web/indexeddb-storage`, camera 상태(VALID/ADJUSTED/RECALIBRATION) 판정 로직 |
| C | 시간 상태/평가 | `src/core/temporal-state-machine`, `src/core/feedback-generator`, `src/evaluation/*` |
| 공용 | 다 같이 | `src/core/types.ts`, `src/web/app/main.ts`, `sample-data/`, `docs/`, `README.md`, `.github/workflows/` |

다른 사람 담당 폴더는 웬만하면 건드리지 않기. 필요하면 먼저 얘기하고 수정.

## 공용 파일 수정 규칙

`src/core/types.ts`처럼 여러 명이 import해서 쓰는 파일은:

- 필드 **추가**는 자유롭게 (기존 코드를 안 깨뜨림)
- 필드 **삭제·타입 변경**은 다른 두 명이 그 필드를 안 쓰는지 확인하거나 미리 알리고 진행
- 변경 후에는 팀 전체에 "types.ts 바꿨다" 정도는 공유

`src/web/app/main.ts`, CI 워크플로우도 같은 원칙.

## 작업 흐름

1. 자기 role 브랜치 최신화: `git checkout a && git pull --ff-only`
2. 그 위에 일차별 브랜치 새로 파서 작업: `git checkout -b a/day3-feature-stabilization`
3. 커밋 전 로컬에서 통과 확인
   ```
   npm run lint
   npm run typecheck
   npm run build
   ```
   (CI에서도 동일하게 검사하므로 로컬에서 먼저 잡는 게 빠름)
4. 끝나면 자기 role 브랜치(`a`/`b`/`c`)로 머지 (PR 열어도 되고 로컬 머지 후 push해도 됨 — 어차피 본인만 쓰는 브랜치)
5. role 브랜치를 main에 반영해야 할 때(다른 사람이 결과물이 필요하거나 마일스톤 시점)는 GitHub에서 `a`/`b`/`c` → `main` PR 생성 → CI 통과 확인 → 머지
6. main이 바뀌면 다른 두 명도 각자 role 브랜치에 `git merge main`으로 최신화

## 커밋 메시지

강제는 아니지만 `Day1(A): ...`, `Day2(B): ...`처럼 `DayN(역할):` 접두사를 붙이면 나중에 히스토리에서 누가 언제 뭘 했는지 찾기 쉽습니다.

## 충돌 방지 팁

- 같은 파일을 동시에 여러 명이 손대지 않기 — 담당 폴더 기준으로 나눠서 작업
- 브랜치를 오래 묵히지 말고 자주 main과 동기화 (오래 방치할수록 충돌 커짐)
- `main`이나 다른 사람 브랜치에 **force-push 금지** — 정말 필요하면 먼저 팀에 알리기
- `git status`로 뭐가 스테이징되는지 확인하고 커밋 (`git add -A` 남발 주의)
