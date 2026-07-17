# 협업 / Git 규칙

3명이 같은 코어를 병렬로 건드리는 프로젝트라, 충돌을 줄이려면 아래 규칙을 지켜주세요.
역할 분담 자체는 [plan.md](./plan.md) 22절 참고.

## 브랜치 이름 규칙

```
main
├── a/<topic>   예: a/landmark-reliability
├── b/<topic>   예: b/profile-baseline
└── c/<topic>   예: c/temporal-evaluation
```

**형식**: `<role>/<topic>` (`<role>`은 `a`/`b`/`c`, `<topic>`은 이번 작업 한두 단어). `main`에서 바로 분기하고, 끝나면 GitHub에서 `main`으로 바로 PR — 중간에 role 통합 브랜치(a/b/c 전용 브랜치)는 따로 두지 않는다. 인원도 적고(3명) 기간도 짧아서(6일) 중간 계층을 두면 관리 부담만 커지고, 인터페이스가 어긋난 걸 늦게 발견하는 위험이 생긴다.

**언제 새로 파나**:
- 항상 최신 `main`에서 분기 (오래된 base에서 파면 나중에 충돌이 커짐)
- 작업 단위(topic) 하나당 브랜치 하나 — 같은 topic 브랜치를 계속 이어 쓰지 않기. 예: landmark reliability 작업 끝나고 camera profile 작업을 시작하면 새로 파기
- 이미 PR 올려서 리뷰/머지 대기 중인 브랜치에는 관련 없는 다음 작업을 쌓지 않는다 — 그 PR이 머지되길 기다리는 동안 다른 작업을 하고 싶으면 `main`에서 새 브랜치를 따로 파기
- 하루 안에 서로 무관한 작업을 여러 개 한다면(예: confidence filter랑 camera raw feature를 같은 날 손댄다면) 하나로 묶지 말고 각각 별도 브랜치 + 별도 PR로 쪼개서 리뷰 단위를 작게 유지
- 반대로 너무 잘게 쪼개서 서로 못 쓰는 반쪽짜리 코드를 계속 만들지는 않기 — 하나의 PR이 "그 자체로 빌드/타입체크가 통과하는 완결된 단위"인지가 기준

**소유권**: 다른 사람 브랜치는 절대 건들지 않는다. 남의 `<role>/<topic>` 브랜치를 대신 만들거나, push하거나, 삭제하지 않는다. 각자 자기 브랜치는 자기가 만들고 자기가 지운다 — 필요하면 얘기해서 본인이 직접 하게 하기.

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
2. `<role>/<topic>` 브랜치 새로 파서 작업
3. 커밋 전 로컬에서 통과 확인
   ```
   npm run lint
   npm run typecheck
   npm run build
   ```
   (CI에서도 동일하게 검사하므로 로컬에서 먼저 잡는 게 빠름)
4. GitHub에서 main으로 PR 생성 → CI 통과 확인 → 머지
5. 머지 후 다른 사람도 `git pull`로 최신화
6. 머지된 브랜치는 굳이 바로 안 지워도 됨 — 코드는 main에 있으니 지워도 안전하긴 하지만, 헷갈릴 바엔 그냥 남겨두는 쪽이 안전. 지우고 싶으면 **자기 브랜치만** 각자 알아서.

## 커밋 메시지

강제는 아니지만 `Day1(A): ...`, `Day2(B): ...`처럼 `DayN(역할):` 접두사를 붙이면 나중에 히스토리에서 누가 언제 뭘 했는지 찾기 쉽습니다.

## 충돌 방지 팁

- 같은 파일을 동시에 여러 명이 손대지 않기 — 담당 폴더 기준으로 나눠서 작업
- 브랜치를 오래 묵히지 말고 자주 main과 동기화 (오래 방치할수록 충돌 커짐)
- `main`이나 다른 사람 브랜치에 **force-push 금지** — 정말 필요하면 먼저 팀에 알리기
- `git status`로 뭐가 스테이징되는지 확인하고 커밋 (`git add -A` 남발 주의)
