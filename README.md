# Into-the-Deep — PostureFairy

몰입캠프 26s-w3-c3-06 프로젝트 repository.

웹캠으로 자세를 인식해서 거북목/기대기/트위스트 같은 나쁜 자세가 일정 시간 지속되면 화면 위 요정 캐릭터가 알려주는 자세 코치 앱입니다. 브라우저(웹)와 Electron 데스크톱 앱 둘 다로 동작합니다.

기획 상세는 [plan.md](./plan.md) 참고.

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

핵심 판정 로직은 `src/core/posture-rules`(자세별 규칙)와 `src/core/posture-rule-detector`(규칙 평가 + 지속시간 판정)에 있습니다. 정면 캘리브레이션과 측면(각도) 캘리브레이션은 서로 다른 규칙 세트(`DEFAULT_POSTURE_RULES` / `SIDE_ANGLE_POSTURE_RULES`)로 독립적으로 튜닝됩니다.

## 협업 규칙

3명이 코어를 병렬로 건드리는 프로젝트라 브랜치/담당 폴더 규칙이 있습니다 — [collab.md](./collab.md) 참고.
