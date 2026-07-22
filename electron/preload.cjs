// Shared preload for both Electron windows (detector + overlay). Exposes a
// minimal, purpose-specific bridge instead of the raw ipcRenderer/electron
// APIs, per Electron's contextIsolation guidance — the renderer never gets
// direct Node/IPC access.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Sent by the headless detector window when a posture alert should pop
  // the fairy up; forwarded by main.cjs to the overlay window.
  sendPostureAlert: (payload) => ipcRenderer.send("posture-alert", payload),

  // Received by the overlay window.
  onPostureAlert: (callback) => {
    ipcRenderer.on("posture-alert", (_event, payload) => callback(payload));
  },

  // macOS-only "new version available" notice (see checkForMacUpdate in
  // main.cjs) — the unsigned-build stand-in for real auto-update.
  onUpdateAvailable: (callback) => {
    ipcRenderer.on("update-available", (_event, payload) => callback(payload));
  },
  openExternal: (url) => ipcRenderer.send("open-external", url),

  // Overlay window is otherwise click-through (transparent + always-on-top
  // + setIgnoreMouseEvents); this lets it re-enable clicks only while the
  // pointer is over the fairy/bubble so it doesn't block whatever app sits
  // underneath the rest of the transparent window.
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send("set-ignore-mouse-events", ignore),

  // Sent by the headless detector window on startup when there's no saved
  // profile yet; main.cjs reacts by auto-opening the calibration window.
  notifyNoProfile: () => ipcRenderer.send("no-profile"),

  // Whether calibration has already completed once during this run of the
  // app (main process lifetime) — resets to false on every app launch, so a
  // saved profile left over from before a power-off/power-on isn't enough on
  // its own to skip calibration. See calibratedThisRun in main.cjs.
  getRunCalibrated: () => ipcRenderer.invoke("get-run-calibrated"),
  markRunCalibrated: () => ipcRenderer.send("mark-run-calibrated"),
});
