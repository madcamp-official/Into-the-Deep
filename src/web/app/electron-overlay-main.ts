import { FairyWidget } from "../ui/fairy-widget";

// Renderer for the Electron overlay window (electron-overlay.html): just
// the fairy, driven entirely by IPC from the headless detector window
// (electron-detector-main.ts) via main.cjs. No camera/detection logic
// here — this window only ever reacts to "posture-alert" messages.
const fairy = new FairyWidget(document.body, {
  onHoverChange: (hovering) => window.electronAPI.setIgnoreMouseEvents(!hovering),
});

window.electronAPI.onPostureAlert(({ title, message }) => {
  fairy.show(message, title);
});
