// Ambient type for the bridge electron/preload.cjs exposes via
// contextBridge.exposeInMainWorld. Present when running inside the Electron
// shell (electron-detector.html / electron-overlay.html, and product.html
// when loaded as the Electron calibration window); absent on the plain web
// build (product.html hosted outside Electron) — hence optional below.
export interface PostureAlertPayload {
  title: string;
  message: string;
}

export interface ElectronAPI {
  sendPostureAlert(payload: PostureAlertPayload): void;
  onPostureAlert(callback: (payload: PostureAlertPayload) => void): void;
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
