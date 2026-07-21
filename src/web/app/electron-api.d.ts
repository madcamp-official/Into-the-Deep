// Ambient type for the bridge electron/preload.cjs exposes via
// contextBridge.exposeInMainWorld. Only present when running inside the
// Electron shell (electron-detector.html / electron-overlay.html); absent
// on the plain web build (index.html / product.html).
export interface PostureAlertPayload {
  title: string;
  message: string;
}

export interface ElectronAPI {
  sendPostureAlert(payload: PostureAlertPayload): void;
  onPostureAlert(callback: (payload: PostureAlertPayload) => void): void;
  setIgnoreMouseEvents(ignore: boolean): void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
