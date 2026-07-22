// Ambient type for the bridge electron/preload.cjs exposes via
// contextBridge.exposeInMainWorld. Present when running inside the Electron
// shell (electron-detector.html / electron-overlay.html, and product.html
// when loaded as the Electron calibration window); absent on the plain web
// build (product.html hosted outside Electron) — hence optional below.
export interface PostureAlertPayload {
  title: string;
  message: string;
}

// Sent by main.cjs on macOS only, where electron-updater's silent
// Squirrel.Mac auto-update isn't available without a paid Apple code-signing
// certificate — this is the unsigned-build fallback: a fairy alert whose
// bubble opens the new release's GitHub page when clicked. Windows instead
// gets the real thing (autoUpdater in main.cjs) and never sends this.
export interface UpdateAvailablePayload {
  title: string;
  message: string;
  url: string;
}

export interface ElectronAPI {
  sendPostureAlert(payload: PostureAlertPayload): void;
  onPostureAlert(callback: (payload: PostureAlertPayload) => void): void;
  onUpdateAvailable(callback: (payload: UpdateAvailablePayload) => void): void;
  openExternal(url: string): void;
  setIgnoreMouseEvents(ignore: boolean): void;
  notifyNoProfile(): void;
  // Whether calibration already completed once during this app run — see
  // calibratedThisRun in electron/main.cjs.
  getRunCalibrated(): Promise<boolean>;
  markRunCalibrated(): void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
