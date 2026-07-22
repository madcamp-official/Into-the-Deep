// Desktop-overlay-style companion widget: a transient top-right toast, not
// a persistent fixture. It's invisible while posture is fine; on an alert
// it flies in from a tiny point through a loop-de-loop (leaving a golden
// sparkle trail), settles, shows the nudge, then fully vanishes a few
// seconds later — meant to catch your eye for a moment while you keep
// working in whatever app has focus, not sit on screen nagging you.
// Mounted on document.body, not inside any page-specific container — an
// Electron build would drive the same show()/dismiss() API from a separate
// always-on-top transparent BrowserWindow (see note at the bottom).

// The delays/scales below (and the `fairyEnter` animation-duration and
// keyframes in product-style.css) both assume: a 1100ms entrance, a
// resting sprite width of 66px as "current size", and a growth curve that
// starts at a ~3mm-diameter point and passes through ~7mm about 10% of the
// way into the loop. Keep them in sync if either side changes.
//
// scale(t) = s0 + (1 - s0) * t^p, where s0 = 3mm/66px and p is fit so
// scale(0.10) == 7mm/66px (1mm = 96/25.4 CSS px).
//
// Sampled along the loop-de-loop path (see fairyEnter keyframes): each
// point is {delay into the entrance, x/y offset from the resting spot,
// scale}, used to spawn trail sparkles that trace the fairy's flight
// instead of a static burst.
const TRAIL_PATH: ReadonlyArray<{ delay: number; x: number; y: number; scale: number }> = [
  { delay: 0, x: 15, y: -5, scale: 0.17 },
  { delay: 69, x: 20.6, y: -2, scale: 0.35 },
  { delay: 138, x: 22.4, y: 4.9, scale: 0.43 },
  { delay: 206, x: 19.2, y: 12.8, scale: 0.5 },
  { delay: 275, x: 11.3, y: 18.8, scale: 0.55 },
  { delay: 344, x: 0.4, y: 20.4, scale: 0.6 },
  { delay: 413, x: -10.5, y: 16.8, scale: 0.65 },
  { delay: 481, x: -18.8, y: 8.5, scale: 0.69 },
  { delay: 550, x: -22.5, y: -2.5, scale: 0.73 },
  { delay: 619, x: -20.7, y: -13.5, scale: 0.77 },
  { delay: 688, x: -14.3, y: -21.8, scale: 0.81 },
  { delay: 756, x: -5.2, y: -25.4, scale: 0.84 },
  { delay: 825, x: 3.7, y: -23.8, scale: 0.88 },
  { delay: 894, x: 9.8, y: -17.8, scale: 0.91 },
  { delay: 963, x: 11.2, y: -9.9, scale: 0.94 },
  { delay: 1031, x: 7.4, y: -3, scale: 0.97 },
];

const FAIRY_SVG = `
<svg viewBox="0 0 120 160" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="요정">
  <ellipse cx="58" cy="150" rx="22" ry="5" fill="#000" opacity="0.16" />
  <!-- wings -->
  <path d="M44 58 C 16 44, 6 64, 22 82 C 32 94, 44 86, 44 72 Z" fill="#d7f2e6" opacity="0.85" />
  <path d="M72 58 C 100 44, 110 64, 94 82 C 84 94, 72 86, 72 72 Z" fill="#d7f2e6" opacity="0.85" />
  <!-- legs -->
  <path d="M50 118 C 48 128, 46 136, 45 144" stroke="#f6d3ab" stroke-width="7" stroke-linecap="round" fill="none" />
  <path d="M66 118 C 68 128, 70 136, 71 144" stroke="#f6d3ab" stroke-width="7" stroke-linecap="round" fill="none" />
  <!-- shoes -->
  <path d="M38 144 C 38 140, 44 138, 50 140 C 53 141, 52 147, 47 148 C 42 149, 38 148, 38 144 Z" fill="#4fae74" />
  <path d="M64 144 C 64 140, 70 138, 76 140 C 79 141, 78 147, 73 148 C 68 149, 64 148, 64 144 Z" fill="#4fae74" />
  <circle cx="48" cy="140" r="2" fill="#eafff2" />
  <circle cx="74" cy="140" r="2" fill="#eafff2" />
  <!-- dress -->
  <path d="M58 64 C 42 64, 34 96, 32 116 C 46 124, 72 124, 86 116 C 84 96, 74 64, 58 64 Z" fill="#63c78a" />
  <path d="M58 64 C 42 64, 34 96, 32 116 C 46 124, 72 124, 86 116 C 84 96, 74 64, 58 64 Z" fill="url(#dressShade)" opacity="0.5" />
  <path d="M40 90 L 78 90" stroke="#4fae74" stroke-width="2" opacity="0.55" />
  <path d="M58 78 l-4 8 l4 6 l4-6 Z" fill="#f2a7c3" opacity="0.9" />
  <!-- torso / arms -->
  <path d="M46 68 C 42 78, 40 86, 32 90" stroke="#f6d3ab" stroke-width="7" stroke-linecap="round" fill="none" />
  <path d="M70 68 C 76 66, 80 60, 82 52" stroke="#f6d3ab" stroke-width="7" stroke-linecap="round" fill="none" />
  <!-- head -->
  <circle cx="58" cy="48" r="17" fill="#f6d3ab" />
  <!-- blonde hair: top bun + swept fringe -->
  <path d="M41 46 C 38 30, 48 20, 58 20 C 69 20, 79 29, 77 44 C 72 36, 66 42, 58 37 C 50 42, 45 37, 41 46 Z" fill="#f4c542" />
  <circle cx="58" cy="18" r="7" fill="#f4c542" />
  <path d="M53 15 C 55 12, 61 12, 63 15" stroke="#e0ab2b" stroke-width="1.4" fill="none" stroke-linecap="round" />
  <circle cx="51" cy="49" r="2" fill="#3a2a1a" />
  <circle cx="65" cy="49" r="2" fill="#3a2a1a" />
  <path d="M53 57 Q58 60 63 57" stroke="#b5673f" stroke-width="1.6" fill="none" stroke-linecap="round" />
  <circle cx="47" cy="53" r="3" fill="#f7a6b0" opacity="0.55" />
  <circle cx="69" cy="53" r="3" fill="#f7a6b0" opacity="0.55" />
  <!-- wand: straight stick + star tip -->
  <line x1="82" y1="52" x2="102" y2="26" stroke="#caa15a" stroke-width="2.6" stroke-linecap="round" />
  <g class="sparkle">
    <path d="M102,18 L104.6,23.4 L110.4,24.6 L106.2,28.6 L107.4,34.4 L102,31.4 L96.6,34.4 L97.8,28.6 L93.6,24.6 L99.4,23.4 Z" fill="#ffe066" stroke="#f6c445" stroke-width="0.6" />
  </g>
  <g class="sparkle sparkle--delay">
    <path d="M88,36 L89.3,39 L92.3,40.3 L89.3,41.6 L88,44.6 L86.7,41.6 L83.7,40.3 L86.7,39 Z" fill="#ffe58a" />
  </g>
  <defs>
    <linearGradient id="dressShade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.35" />
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
    </linearGradient>
  </defs>
</svg>
`;

export interface FairyWidgetOptions {
  /** How long the fairy + bubble stay up before vanishing entirely, ms. */
  autoHideMs?: number;
  /**
   * Fires when the pointer enters/leaves the widget. Unused on the web
   * demo; the Electron overlay window is otherwise click-through
   * (transparent + setIgnoreMouseEvents), and uses this to re-enable
   * clicks only while hovering the fairy/bubble so the rest of the
   * always-on-top window doesn't block the app underneath.
   */
  onHoverChange?: (hovering: boolean) => void;
}

type FairyState = "hidden" | "entering" | "talking" | "exiting";

export class FairyWidget {
  private readonly container: HTMLElement;
  private readonly root: HTMLDivElement;
  private readonly bubble: HTMLDivElement;
  private readonly titleEl: HTMLElement;
  private readonly messageEl: HTMLDivElement;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly trailTimers: Array<ReturnType<typeof setTimeout>> = [];
  private readonly autoHideMs: number;
  private state: FairyState = "hidden";
  private onBubbleClick: (() => void) | null = null;

  constructor(container: HTMLElement, options: FairyWidgetOptions = {}) {
    this.container = container;
    this.autoHideMs = options.autoHideMs ?? 4500;

    this.root = document.createElement("div");
    this.root.className = "fairy-widget";

    const sprite = document.createElement("div");
    sprite.className = "fairy-widget__sprite";
    sprite.innerHTML = FAIRY_SVG;

    this.bubble = document.createElement("div");
    this.bubble.className = "fairy-widget__bubble";

    const dismissBtn = document.createElement("button");
    dismissBtn.className = "fairy-widget__dismiss";
    dismissBtn.textContent = "✕";
    dismissBtn.setAttribute("aria-label", "닫기");
    dismissBtn.onclick = (event) => {
      // Stop this from also reaching the bubble's own click listener below
      // (onBubbleClick) — dismissing and triggering the alert's action
      // aren't the same gesture.
      event.stopPropagation();
      this.dismiss();
    };

    this.titleEl = document.createElement("strong");
    this.messageEl = document.createElement("div");
    this.bubble.append(dismissBtn, this.titleEl, this.messageEl);
    this.bubble.addEventListener("click", () => this.onBubbleClick?.());

    this.root.append(this.bubble, sprite);

    if (options.onHoverChange) {
      // Bound to the bubble specifically (not root): root is
      // pointer-events:none by default so the overlay stays click-through,
      // and the bubble is the one part that sets pointer-events:auto
      // (only while .talking) and is therefore reliably hit-testable.
      const onHoverChange = options.onHoverChange;
      this.bubble.addEventListener("mouseenter", () => onHoverChange(true));
      this.bubble.addEventListener("mouseleave", () => onHoverChange(false));
    }
  }

  /**
   * Pop the fairy in with a specific title (e.g. "고개가 기울어졌어요") and a
   * more detailed explanation of what to fix. Every call starting from
   * hidden/exiting plays the full point -> loop-de-loop -> settle entrance
   * with a trailing sparkle, and the bubble only appears once the fairy
   * has actually reached full size (entrance animation complete) — not
   * while it's still mid-flight. The fairy and bubble then vanish together
   * after autoHideMs. A call while already talking just refreshes the text
   * and the auto-hide timer, without replaying the entrance.
   *
   * `onClick`, when given, fires if the bubble itself (not its ✕ button) is
   * clicked — e.g. opening a link. Purely additive: the bubble stays
   * click-through everywhere else via the Electron overlay's
   * setIgnoreMouseEvents dance (see onHoverChange above), unaffected by
   * whether this particular alert has a click action or not.
   */
  show(message: string, title = "요정이 알려줘요", onClick?: () => void): void {
    this.titleEl.textContent = title;
    this.messageEl.textContent = message;
    this.onBubbleClick = onClick ?? null;
    this.bubble.classList.toggle("fairy-widget__bubble--clickable", Boolean(onClick));

    if (this.state === "talking") {
      this.startTalking();
      return;
    }

    if (this.state === "hidden" || this.state === "exiting") {
      this.playEntrance(() => this.startTalking());
    }
    // else state === "entering": already flying in; startTalking() fires
    // from that in-flight entrance's own completion callback.
  }

  private startTalking(): void {
    this.root.classList.remove("exiting");
    this.root.classList.add("visible", "talking");
    this.state = "talking";

    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.dismiss(), this.autoHideMs);
  }

  /** Fades the fairy and its bubble out together and fully vanishes. */
  dismiss(): void {
    if (this.state === "hidden" || this.state === "exiting") return;
    this.clearTrailTimers();
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    this.root.classList.remove("entering", "talking");
    this.root.classList.add("exiting");
    this.state = "exiting";

    this.root.addEventListener(
      "animationend",
      () => {
        this.root.classList.remove("visible", "exiting");
        this.state = "hidden";
      },
      { once: true },
    );
  }

  private playEntrance(onComplete: () => void): void {
    if (!this.root.isConnected) this.container.append(this.root);

    this.clearTrailTimers();
    this.spawnSparkleTrail();
    this.root.classList.add("entering");
    this.state = "entering";
    this.root.addEventListener(
      "animationend",
      () => {
        this.root.classList.remove("entering");
        onComplete();
      },
      { once: true },
    );
  }

  // Spawns a sparkle at each sampled point along the fairyEnter loop path,
  // timed to appear as the fairy passes through it — a trail that traces
  // the actual flight instead of a static burst.
  private spawnSparkleTrail(): void {
    for (const point of TRAIL_PATH) {
      const timer = setTimeout(() => {
        const dot = document.createElement("div");
        dot.className = "fairy-sparkle-trail";
        dot.style.setProperty("--fx", `${point.x}px`);
        dot.style.setProperty("--fy", `${point.y}px`);
        dot.style.setProperty("--fscale", `${Math.max(point.scale, 0.35)}`);
        this.container.append(dot);
        setTimeout(() => dot.remove(), 650);
      }, point.delay);
      this.trailTimers.push(timer);
    }
  }

  private clearTrailTimers(): void {
    for (const timer of this.trailTimers.splice(0)) clearTimeout(timer);
  }
}

// --- Electron overlay note --------------------------------------------
// For the "always-on-top desktop overlay" version, this widget's markup
// can be reused as-is inside a small transparent, click-through
// BrowserWindow (frame: false, transparent: true, alwaysOnTop: true,
// setIgnoreMouseEvents(true) except over the bubble). The main process
// would forward alert state from the detection loop over IPC and call
// the same show()/dismiss() in that renderer — this is also the only way
// to get a true "notification appears while VS Code has focus" overlay;
// a plain browser tab can't paint above other native windows, and browsers
// throttle rAF/timers once the tab itself is backgrounded.

