# 협업 / Git 규칙

3명이 같은 코어를 병렬로 건드리는 프로젝트라, 충돌을 줄이려면 아래 규칙을 지켜주세요.
역할 분담 자체는 [plan.md](./plan.md) 22절 참고.

## 브랜치 이름

```
feature/<role>-<topic>
```

예: `feature/a-vision-pipeline`, `feature/b-profile-baseline`, `feature/a-landmark-reliability`

- `<role>`은 `a`/`b`/`c`, `<topic>`은 이번 브랜치에서 만드는 기능 한두 단어.
- 같은 topic 브랜치를 계속 이어 쓰지 말고, 새 기능은 새 브랜치로 파서 PR 단위를 작게 유지.
- **스텁(stub) 브랜치 안내**: Day1에 미리 만들어둔 `feature/b-profile-baseline`, `feature/c-temporal-evaluation`은 각 담당자가 실제 작업을 시작할 때 이어서 써도 되고, 이름이 마음에 안 들면 새로 파도 됩니다. 스텁은 소유권 주장이 아니라 "인터페이스 먼저 고정해둔 뼈대 코드"일 뿐이에요.

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

1. 작업 시작 전 `git checkout main && git pull --ff-only`로 최신화
2. `feature/<role>-<topic>` 브랜치 새로 파서 작업
3. 커밋 전 로컬에서 통과 확인
   ```
   npm run lint
   npm run typecheck
   npm run build
   ```
   (CI에서도 동일하게 검사하므로 로컬에서 먼저 잡는 게 빠름)
4. GitHub에서 main으로 PR 생성 → CI 통과 확인 → 머지
5. 머지 후 다른 사람도 `git pull`로 최신화

## 커밋 메시지

강제는 아니지만 `Day1(A): ...`, `Day2(B): ...`처럼 `DayN(역할):` 접두사를 붙이면 나중에 히스토리에서 누가 언제 뭘 했는지 찾기 쉽습니다.

## 충돌 방지 팁

- 같은 파일을 동시에 여러 명이 손대지 않기 — 담당 폴더 기준으로 나눠서 작업
- 브랜치를 오래 묵히지 말고 자주 main과 동기화 (오래 방치할수록 충돌 커짐)
- `main`이나 다른 사람 브랜치에 **force-push 금지** — 정말 필요하면 먼저 팀에 알리기
- `git status`로 뭐가 스테이징되는지 확인하고 커밋 (`git add -A` 남발 주의)
