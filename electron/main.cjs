// Electron shell around the existing web app. Two windows:
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
// Two run modes:
//  - Dev: `npm run electron:dev` starts a Vite dev server and passes its URL
//    via --url; windows loadURL from there. See electron/dev-launcher.js.
//  - Packaged: no dev server. Windows loadFile the pre-built dist/*.html
//    (produced by `npm run build`) that electron-builder bundles alongside
//    this file — see the "build" config in package.json.
// Packaged-only extras: registers itself to launch at Windows login, and
// auto-opens calibration on first run (no saved profile yet) instead of
// requiring a trip to the tray menu — the whole point of "installed" is
// opening the laptop and being immediately ready to calibrate.
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, session, shell } = require("electron");
const path = require("node:path");
const { autoUpdater } = require("electron-updater");

// Same repo package.json's "build.publish" points electron-builder's
// Windows NSIS updates at — reused below for the macOS update-notice
// fallback's own GitHub API lookup and openExternal allowlist.
const REPO_OWNER = "madcamp-official";
const REPO_NAME = "Into-the-Deep";

const devServerUrl = app.isPackaged ? null : getDevServerUrlFromArgs();

// Packaged installer/taskbar/dock icon comes from build/icon.png via
// electron-builder's auto-discovery (no config needed — see package.json
// comment-free "build" section). This is the same source asset, just for
// the runtime uses electron-builder's icon step doesn't cover: the tray
// icon, and each BrowserWindow's icon (mainly matters in dev, where there's
// no packaged exe to carry an embedded icon resource).
const APP_ICON_PATH = path.join(__dirname, "assets", "logo", "fairy-icon-256.png");

// Tray-driven app that mostly never fully quits on its own (launches at
// login, only exits via the tray's "종료"), so a single check on startup
// isn't enough to catch a release published mid-session — recheck on this
// interval too. 4h keeps it well under GitHub's unauthenticated rate limits
// while still landing new releases the same day they ship.
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let detectorWindow = null;
let overlayWindow = null;
let calibrationWindow = null;
let tray = null;

// Reset to false every time this process starts (app launch, including the
// openAtLogin auto-start after a reboot) — never persisted to disk. Renderers
// use this (via get-run-calibrated/mark-run-calibrated IPC) to tell "already
// calibrated earlier in this run" apart from "calibrated in some previous
// run, saved profile just happens to still be on disk" — only the former
// should be allowed to skip straight to detection, so a saved profile alone
// is no longer enough to skip calibration after a power-off/power-on.
let calibratedThisRun = false;

function getDevServerUrlFromArgs() {
  const flagIndex = process.argv.indexOf("--url");
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) {
    return process.argv[flagIndex + 1].replace(/\/$/, "");
  }
  return "http://localhost:5173";
}

// dist/*.html reference their JS/CSS with relative paths (vite.config.ts
// sets base: "./") specifically so this works under file://.
function loadPage(win, htmlFileName) {
  if (devServerUrl) {
    win.loadURL(`${devServerUrl}/${htmlFileName}`);
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", htmlFileName));
  }
}

function createDetectorWindow() {
  detectorWindow = new BrowserWindow({
    show: false,
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  loadPage(detectorWindow, "electron-detector.html");
  if (devServerUrl) {
    // The window itself is hidden, so without this, camera/permission/model
    // errors would be silently swallowed. Dev-only convenience.
    detectorWindow.webContents.on("did-finish-load", () => {
      detectorWindow.webContents.openDevTools({ mode: "detach" });
    });
  }
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
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  // macOS-specific: without this, a full-screen app (its own Space) or
  // another virtual desktop would cover the overlay despite alwaysOnTop —
  // Windows doesn't have this Spaces/virtual-desktop distinction, so
  // setVisibleOnAllWorkspaces is a no-op there.
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  loadPage(overlayWindow, "electron-overlay.html");
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
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  loadPage(calibrationWindow, "product.html");
  if (devServerUrl) {
    // Dev-only: surface the [webcam] track diagnostics (see webcam.ts) so
    // camera capture issues are visible instead of just a black/placeholder
    // canvas.
    calibrationWindow.webContents.once("did-finish-load", () => {
      calibrationWindow?.webContents.openDevTools({ mode: "detach" });
    });
  }
  calibrationWindow.on("closed", () => {
    calibrationWindow = null;
    createDetectorWindow();
  });
}

function createTrayIcon() {
  // Windows tray/macOS menu bar both want a small icon (16x16, scaled up
  // for HiDPI) — resize down from the same 256px source everything else
  // uses rather than keeping a separate tiny asset to maintain.
  return nativeImage.createFromPath(APP_ICON_PATH).resize({ width: 16, height: 16 });
}

// Downloads silently in the background and applies itself the next time
// the app actually quits (autoInstallOnAppQuit, on by default) — tray's
// "종료" or a machine restart — never quitAndInstall() on the spot, which
// would yank the app out from under whatever the user is doing right now.
// Packaged only: dev builds have no update feed (no dev-app-update.yml),
// and checkForUpdates() would just throw.
//
// Windows-only. macOS builds are unsigned (no paid Apple Developer
// certificate in this repo — see the CI workflow's
// CSC_IDENTITY_AUTO_DISCOVERY note), and Squirrel.Mac (the macOS half of
// electron-updater) refuses to install an update onto an unsigned app —
// that's macOS enforcing it, not something electron-updater config can
// route around. checkForMacUpdateNotice() below is the fallback for that
// platform: not a silent install, just a fairy alert linking to the new
// release so the user knows to go grab it.
function setupAutoUpdates() {
  if (process.platform === "win32") {
    autoUpdater.on("error", (error) => {
      console.error("auto-update check failed", error);
    });

    const check = () => {
      autoUpdater.checkForUpdates().catch((error) => {
        console.error("auto-update check failed", error);
      });
    };

    check();
    setInterval(check, UPDATE_CHECK_INTERVAL_MS);
    return;
  }

  if (process.platform === "darwin") {
    const check = () => {
      checkForMacUpdateNotice().catch((error) => {
        console.error("mac update check failed", error);
      });
    };

    check();
    setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  }
}

// Compares app.getVersion() (package.json's "version", baked in at build
// time) against GitHub's latest tagged release and, if there's a newer one,
// tells the overlay window to show a fairy alert whose bubble opens that
// release's page on click — see onUpdateAvailable in preload.cjs /
// electron-overlay-main.ts. Unauthenticated GitHub API call, well under
// its rate limit at one check per UPDATE_CHECK_INTERVAL_MS.
async function checkForMacUpdateNotice() {
  const response = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
  );
  if (!response.ok) {
    throw new Error(`GitHub releases lookup failed: ${response.status}`);
  }

  const release = await response.json();
  const latestVersion = String(release.tag_name ?? "").replace(/^v/, "");
  if (!latestVersion || !isNewerVersion(latestVersion, app.getVersion())) return;

  overlayWindow?.webContents.send("update-available", {
    title: "새 버전이 나왔어요",
    message: `PostureFairy ${latestVersion}가 나왔어요. 눌러서 다운로드 페이지를 열어보세요.`,
    url: release.html_url,
  });
}

// Plain dotted-integer comparison (1.2.10 > 1.2.9) — good enough for this
// repo's version scheme; no pre-release/build-metadata suffixes to parse.
function isNewerVersion(candidate, current) {
  const a = candidate.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = current.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("요정 — 바른 자세 코치");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "캘리브레이션 시작", click: () => openCalibrationWindow() },
      { type: "separator" },
      { label: "종료", click: () => app.quit() },
    ]),
  );
}

app.whenReady().then(() => {
  // Auto-grant camera access — this app has no other consent UI of its own
  // yet, and this permission gate is the standard Electron one for the
  // "media" (mic/camera) request, separate from the OS-level camera privacy
  // toggle Windows still enforces on top of this.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media");
  });

  if (app.isPackaged) {
    // "설치하면 켤 때마다 바로 쓸 수 있게" — launch at Windows login so the
    // detector/overlay are already running when the laptop opens. Only
    // meaningful once packaged: in dev this would register whatever
    // Electron dev binary happened to run this, not something worth
    // auto-starting.
    app.setLoginItemSettings({ openAtLogin: true });
    setupAutoUpdates();
  }

  createDetectorWindow();
  createOverlayWindow();
  createTray();
});

ipcMain.on("posture-alert", (_event, payload) => {
  overlayWindow?.webContents.send("posture-alert", payload);
});

ipcMain.on("posture-alert-clear", () => {
  overlayWindow?.webContents.send("posture-alert-clear");
});

ipcMain.on("set-ignore-mouse-events", (event, ignore) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.setIgnoreMouseEvents(ignore, { forward: true });
});

// Sent when the overlay's "새 버전이 나왔어요" bubble (macOS update notice) is
// clicked. Allowlisted to this repo's own GitHub pages rather than trusting
// an arbitrary renderer-supplied URL — in practice this only ever round-trips
// the html_url checkForMacUpdateNotice() itself fetched from GitHub's API,
// but the renderer is untrusted by contextIsolation's threat model regardless.
ipcMain.on("open-external", (_event, url) => {
  if (typeof url === "string" && url.startsWith(`https://github.com/${REPO_OWNER}/${REPO_NAME}/`)) {
    shell.openExternal(url);
  }
});

// First run (or profile cleared): jump straight to calibration instead of
// making the user find the tray icon — "바로 진행" is the point of having
// this launch automatically at login.
ipcMain.on("no-profile", () => {
  openCalibrationWindow();
});

// Renderers check this before trusting a saved profile off disk — see
// calibratedThisRun above. Read via invoke (needs a return value), written
// via a fire-and-forget send once product-main.ts finishes calibrating.
ipcMain.handle("get-run-calibrated", () => calibratedThisRun);
ipcMain.on("mark-run-calibrated", () => {
  calibratedThisRun = true;
});

app.on("window-all-closed", () => {
  // Tray-driven app: closing the (hidden/overlay) windows shouldn't quit —
  // only the tray's "종료" does.
});
