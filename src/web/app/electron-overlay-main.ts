import { FairyWidget } from "../ui/fairy-widget";

// Renderer for the Electron overlay window (electron-overlay.html): just
// the fairy, driven entirely by IPC from the headless detector window
// (electron-detector-main.ts) and main.cjs. No camera/detection logic here —
// this window only ever reacts to "posture-alert" / "update-available"
// messages.
// electronAPI is only optional on the plain web build (see electron-api.d.ts);
// this window is Electron-only, so it's always injected here.
const electronAPI = window.electronAPI!;

const fairy = new FairyWidget(document.body, {
  onHoverChange: (hovering) => electronAPI.setIgnoreMouseEvents(!hovering),
});

electronAPI.onPostureAlert(({ title, message, persist }) => {
  fairy.show(message, title, { persist });
});

// Bad-posture alerts are sent with persist:true (see electron-detector-main.ts)
// and don't auto-hide — this is the explicit "posture corrected" signal that
// dismisses one early instead of leaving it up indefinitely.
electronAPI.onPostureAlertClear(() => fairy.dismiss());

// macOS-only (see checkForMacUpdate in main.cjs): clicking the bubble opens
// the new release's GitHub page instead of auto-installing, since this
// build isn't code-signed and can't use Squirrel.Mac.
electronAPI.onUpdateAvailable(({ title, message, url }) => {
  fairy.show(message, title, { onClick: () => electronAPI.openExternal(url) });
});
