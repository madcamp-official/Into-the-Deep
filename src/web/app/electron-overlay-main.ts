import { FairyWidget } from "../ui/fairy-widget";

// Renderer for the Electron overlay window (electron-overlay.html): just
// the fairy, driven entirely by IPC from the headless detector window
// (electron-detector-main.ts) via main.cjs. No camera/detection logic
// here — this window only ever reacts to "posture-alert" messages.
// electronAPI is only optional on the plain web build (see electron-api.d.ts);
// this window is Electron-only, so it's always injected here.
const electronAPI = window.electronAPI!;

const fairy = new FairyWidget(document.body, {
  onHoverChange: (hovering) => electronAPI.setIgnoreMouseEvents(!hovering),
});

electronAPI.onPostureAlert(({ title, message }) => {
  fairy.show(message, title);
});
