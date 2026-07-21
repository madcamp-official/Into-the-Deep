// Step-by-step calibration modal. Purely presentational — it doesn't touch
// the pose pipeline itself. product-main.ts drives it: run the three
// instruction cards, then call showCollecting()/setProgress()/showResult()
// around the existing calibrationFrames collection + buildUserProfile()
// call (same building blocks main.ts's dev harness already uses).

export interface CalibrationStepText {
  step: string; // "1/3" 같은 라벨
  icon: string; // emoji stand-in for an illustration
  title: string;
  desc: string;
}

export const CALIBRATION_STEPS: CalibrationStepText[] = [
  {
    step: "1 / 3",
    icon: "🧍",
    title: "허리를 꼿꼿하게 세워주세요",
    desc: "등을 곧게 펴고 어깨에 힘을 뺀 상태로 앉아주세요.",
  },
  {
    step: "2 / 3",
    icon: "🙆",
    title: "턱을 목 쪽으로 살짝 당겨주세요",
    desc: "고개를 앞으로 내밀지 말고, 귀가 어깨 위로 오도록 맞춰주세요.",
  },
  {
    step: "3 / 3",
    icon: "🪑",
    title: "엉덩이를 의자 등받이 끝까지 붙여주세요",
    desc: "의자 깊숙이 앉아 등받이에 허리 전체가 닿도록 해주세요.",
  },
];

export class CalibrationFlow {
  private readonly slot: HTMLElement;
  private readonly card: HTMLDivElement;

  constructor(slot: HTMLElement) {
    this.slot = slot;
    this.slot.className = "calib-slot";
    this.card = document.createElement("div");
    this.card.className = "calib-card";
    this.slot.append(this.card);
  }

  private mount(): void {
    this.slot.classList.add("visible");
  }

  unmount(): void {
    this.slot.classList.remove("visible");
  }

  /** Walks the person through the 3 posture-setup instructions. */
  runInstructions(onDone: () => void): void {
    this.mount();
    let index = 0;

    const renderStep = () => {
      const s = CALIBRATION_STEPS[index];
      const isLast = index === CALIBRATION_STEPS.length - 1;
      this.card.innerHTML = "";

      const stepLabel = document.createElement("div");
      stepLabel.className = "calib-card__step";
      stepLabel.textContent = `캘리브레이션 ${s.step}`;

      const icon = document.createElement("div");
      icon.className = "calib-card__icon";
      icon.textContent = s.icon;

      const title = document.createElement("h2");
      title.className = "calib-card__title";
      title.textContent = s.title;

      const desc = document.createElement("p");
      desc.className = "calib-card__desc";
      desc.textContent = s.desc;

      const dots = document.createElement("div");
      dots.className = "calib-card__dots";
      CALIBRATION_STEPS.forEach((_, i) => {
        const dot = document.createElement("span");
        if (i === index) dot.classList.add("active");
        dots.append(dot);
      });

      const nextBtn = document.createElement("button");
      nextBtn.className = "btn btn-primary";
      nextBtn.textContent = isLast ? "준비됐어요, 측정 시작" : "다음";
      nextBtn.onclick = () => {
        if (isLast) {
          onDone();
        } else {
          index += 1;
          renderStep();
        }
      };

      this.card.append(stepLabel, icon, title, desc, dots, nextBtn);
    };

    renderStep();
  }

  /** Switches the modal into the "measuring, hold still" progress state. */
  showCollecting(): void {
    this.mount();
    this.card.innerHTML = "";

    const stepLabel = document.createElement("div");
    stepLabel.className = "calib-card__step";
    stepLabel.textContent = "측정 중";

    const icon = document.createElement("div");
    icon.className = "calib-card__icon";
    icon.textContent = "✨";

    const title = document.createElement("h2");
    title.className = "calib-card__title";
    title.textContent = "지금 자세를 유지해주세요";

    const desc = document.createElement("p");
    desc.className = "calib-card__desc";
    desc.textContent = "잠시만 그대로 계셔주세요. 바른 자세를 기준으로 저장할게요.";

    const progressTrack = document.createElement("div");
    progressTrack.className = "calib-card__progress";
    const progressBar = document.createElement("div");
    progressBar.className = "calib-card__progress-bar";
    progressBar.id = "calib-progress-bar";
    progressTrack.append(progressBar);

    this.card.append(stepLabel, icon, title, desc, progressTrack);
  }

  setProgress(ratio: number): void {
    const bar = this.card.querySelector<HTMLDivElement>("#calib-progress-bar");
    if (bar) bar.style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`;
  }

  showResult(success: boolean, detail: string, onContinue: () => void): void {
    this.mount();
    this.card.innerHTML = "";

    const icon = document.createElement("div");
    icon.className = "calib-card__result-icon";
    icon.textContent = success ? "🧚" : "😥";

    const title = document.createElement("h2");
    title.className = "calib-card__title";
    title.textContent = success ? "바른 자세를 기억했어요!" : "다시 시도해볼까요?";

    const desc = document.createElement("p");
    desc.className = "calib-card__desc";
    desc.textContent = detail;

    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.textContent = success ? "시작하기" : "다시 시도";
    btn.onclick = onContinue;

    this.card.append(icon, title, desc, btn);
  }
}
