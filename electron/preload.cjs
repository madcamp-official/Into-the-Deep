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

  // Overlay window is otherwise click-through (transparent + always-on-top
  // + setIgnoreMouseEvents); this lets it re-enable clicks only while the
  // pointer is over the fairy/bubble so it doesn't block whatever app sits
  // underneath the rest of the transparent window.
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send("set-ignore-mouse-events", ignore),
});
