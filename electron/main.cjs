// Dev-only Electron shell around the existing web app. Two windows:
//  - detectorWindow: hidden, backgroundThrottling disabled, runs the same
//    webcam -> pose-landmarker -> PostureRuleDetector pipeline as
//    product.html (see electron-detector.html / electron-detector-main.ts)
//    but headless — no DOM UI, just IPC out on alert. This is the piece a
//    plain browser tab can't do: Chromium throttles rAF/timers once a tab
//    is backgrounded, so detection would stall the moment you alt-tab to
//    another app. A hidden BrowserWindow with backgroundThrottling:false
//    keeps running regardless of what has focus.
//  - overlayWindow: transparent, frameless, always-on-top, click-through
//    (except when hovering the fairy bubble), pinned to the primary
//    display's top-right corner. Shows the same FairyWidget as the web
//    build, driven by IPC instead of direct function calls.
// A tray icon provides "캘리브레이션 시작" (opens a normal window loading the
// existing product.html to calibrate/re-calibrate) and "종료".
//
// Not packaged — run via `npm run electron:dev`, which starts a Vite dev
// server and points these windows at it. See electron/dev-launcher.js.
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, session } = require("electron");
const path = require("node:path");

const devServerUrl = getDevServerUrlFromArgs();

let detectorWindow = null;
let overlayWindow = null;
let calibrationWindow = null;
let tray = null;

function getDevServerUrlFromArgs() {
  const flagIndex = process.argv.indexOf("--url");
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) {
    return process.argv[flagIndex + 1].replace(/\/$/, "");
  }
  return "http://localhost:5173";
}

function createDetectorWindow() {
  detectorWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  detectorWindow.loadURL(`${devServerUrl}/electron-detector.html`);
  // The window itself is hidden, so without this, camera/permission/model
  // errors would be silently swallowed. Dev-only convenience.
  detectorWindow.webContents.on("did-finish-load", () => {
    detectorWindow.webContents.openDevTools({ mode: "detach" });
  });
  detectorWindow.on("closed", () => {
    detectorWindow = null;
  });
}

function createOverlayWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 360;
  const height = 260;

  overlayWindow = new BrowserWindow({
    x: Math.round(workArea.x + workArea.width - width - 8),
    y: Math.round(workArea.y + 8),
    width,
    height,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.loadURL(`${devServerUrl}/electron-overlay.html`);
  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });
}

function openCalibrationWindow() {
  if (calibrationWindow) {
    calibrationWindow.focus();
    return;
  }

  // Re-calibration: the detector window may already be holding the webcam
  // open. Destroy it first so product.html can actually get the camera —
  // Windows webcams are typically single-consumer, so the two can't share
  // a stream. It's recreated (and re-acquires the camera against whatever
  // profile was just saved) once calibration closes.
  detectorWindow?.destroy();
  detectorWindow = null;

  calibrationWindow = new BrowserWindow({
    width: 900,
    height: 720,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  calibrationWindow.loadURL(`${devServerUrl}/product.html`);
  // Dev-only: surface the [webcam] track diagnostics (see webcam.ts) so
  // camera capture issues are visible instead of just a black/placeholder
  // canvas.
  calibrationWindow.webContents.once("did-finish-load", () => {
    calibrationWindow?.webContents.openDevTools({ mode: "detach" });
  });
  calibrationWindow.on("closed", () => {
    calibrationWindow = null;
    createDetectorWindow();
  });
}

function createTrayIcon() {
  // Solid-color square built at runtime (no bundled asset needed for a
  // dev-only tray icon) — Electron's nativeImage.createFromBuffer accepts
  // raw BGRA pixel data directly.
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    buffer[i * 4 + 0] = 0x82; // B
    buffer[i * 4 + 1] = 0xbf; // G
    buffer[i * 4 + 2] = 0x4f; // R  (0x4fbf82 accent green, BGRA order)
    buffer[i * 4 + 3] = 0xff; // A
  }
  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("요정 — 바른 자세 코치 (dev)");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "캘리브레이션 시작", click: () => openCalibrationWindow() },
      { type: "separator" },
      { label: "종료", click: () => app.quit() },
    ]),
  );
}

app.whenReady().then(() => {
  // Auto-grant camera access for the local dev server origin — this is a
  // dev-only shell, not a packaged app users install, so there's no
  // consent UI to build yet.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media");
  });

  createDetectorWindow();
  createOverlayWindow();
  createTray();
});

ipcMain.on("posture-alert", (_event, payload) => {
  console.log("[main] posture-alert ->", payload.title);
  overlayWindow?.webContents.send("posture-alert", payload);
});

ipcMain.on("set-ignore-mouse-events", (event, ignore) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.setIgnoreMouseEvents(ignore, { forward: true });
});

app.on("window-all-closed", () => {
  // Tray-driven app: closing the (hidden/overlay) windows shouldn't quit —
  // only the tray's "종료" does.
});
