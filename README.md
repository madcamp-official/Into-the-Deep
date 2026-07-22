# Into-the-Deep — PostureFairy

몰입캠프 26s-w3-c3-06 프로젝트 repository.

웹캠으로 자세를 인식해서 거북목/기대기/트위스트 같은 나쁜 자세가 일정 시간 지속되면 화면 위 요정 캐릭터가 알려주는 자세 코치 앱. 브라우저(웹)와 Electron 데스크톱 앱 둘 다로 동작한다.

**핵심 아이디어**: 어깨 기울기·머리 위치 같은 값이 고정 임계값을 넘으면 바로 "나쁜 자세"로 보는 흔한 방식은, 키보드 잠깐 보기·물 마시기·의자 위치 조정 같은 일상적인 동작과 실제 지속적인 자세 이탈을 구분하지 못해 오탐이 잦다. 대신 사용자가 calibration으로 등록한 자신의 기준 자세(의학적 정답이 아니라 본인 reference posture)를 기준으로, 일시적 움직임과 지속적인 자세 drift를 구분해서 후자만 알림을 준다. 카메라 각도·위치의 작은 변화도 제한적으로 자동 보정하고, 그 범위를 넘으면 경고 대신 재캘리브레이션을 요청한다.

## Getting Started

```
npm install
npm run dev         # Vite dev server (개발/디버그용 harness, index.html)
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
npm run test        # vitest
npm run build       # typecheck + vite build
```

Electron 데스크톱 앱으로 실행/패키징하려면:

```
npm run electron:dev   # Electron 개발 모드
npm run dist:win       # Windows 설치 파일 빌드 (release/)
npm run dist:mac       # macOS 설치 파일 빌드 (release/)
```

## 진입점

| 파일 | 용도 |
| --- | --- |
| `index.html` / `src/web/app/main.ts` | 개발/디버그용 harness — 캘리브레이션, capture 버튼, 세션 녹화/리플레이 등 튜닝 도구 포함 |
| `product.html` / `src/web/app/product-main.ts` | 실사용자용 웹 UI ("요정 — 바른 자세 코치") |
| `electron-detector.html`, `electron-overlay.html` | Electron 앱 전용 — 백그라운드 감지 + 화면 위 요정 오버레이 |

## 폴더 구조

```
src/
├── core/         # 판정 코어 — feature 계산, 캘리브레이션 프로필, posture rule 판정,
│                 # MAD 정규화, 시간 상태 머신 등 카메라 프레임에 의존하지 않는 순수 로직
├── web/          # 카메라 입력(camera-adapter), canvas overlay, 배경 기반 카메라 움직임
│                 # 추적, IndexedDB 저장, 요정 UI, 앱 진입점(app/)
└── evaluation/   # 세션 녹화(recorder)/리플레이(replay-evaluator), 시나리오 라벨링,
                  # 문턱값 스윕, 정확도 분석 등 오프라인 평가 도구
electron/         # Electron 메인/프리로드 프로세스, 배포 설정
sample-data/      # 평가용 샘플 JSONL 로그
docs/             # 설계 노트, 발표/데모 자료
```

핵심 판정 로직은 `src/core/posture-rules`(자세별 규칙)와 `src/core/posture-rule-detector`(규칙 평가 + 지속시간 판정)에 있다. 정면 캘리브레이션과 측면(각도) 캘리브레이션은 서로 다른 규칙 세트(`DEFAULT_POSTURE_RULES` / `SIDE_ANGLE_POSTURE_RULES`)로 독립적으로 튜닝된다.

## 협업 규칙

3명이 같은 코어를 병렬로 건드리는 프로젝트라 아래 규칙으로 충돌을 줄인다.

- **브랜치**: `<role>/<topic>` (역할은 `a`/`b`/`c`, 주제는 한두 단어). 항상 최신 `main`에서 새로 분기하고, 끝나면 GitHub PR로 `main`에 바로 머지 — 중간 통합 브랜치는 두지 않는다.
- **소유권**: 다른 사람 브랜치는 만들거나 push하거나 지우지 않는다.
- **담당 폴더**:
  | 역할 | 담당 영역 |
  | --- | --- |
  | A | 카메라/랜드마크/feature — `src/web/camera-adapter`, `src/web/canvas-overlay`, `src/core/landmark-reliability`, `src/core/feature-normalizer`, `src/core/camera-profile` |
  | B | profile/score/camera 판정 — `src/core/profile-builder`, `src/core/fixed-threshold-detector`, `src/core/personalized-detector`, `src/web/indexeddb-storage`, 카메라 상태 판정 |
  | C | 시간 상태/평가 — `src/core/temporal-state-machine`, `src/core/feedback-generator`, `src/evaluation/*` |
  | 공용 | `src/core/types.ts`, `src/web/app/main.ts`, `sample-data/`, `docs/`, `README.md` — 필드 추가는 자유, 삭제/타입 변경은 다른 담당자에게 먼저 알리기 |
- **머지 전 로컬 확인**: `npm run lint && npm run typecheck && npm run build` (CI와 동일하게 검사).
- force-push 금지, `git add -A` 대신 필요한 파일만 스테이징.

