import type { UserProfile, CameraProfile } from "../../core/types";

const DB_NAME = "posture-core";
const DB_VERSION = 1;

export interface StoredProfiles {
  userProfile: UserProfile;
  cameraProfile: CameraProfile;
  lastCalibrationAt: number;
}

// TODO(B): open the "posture-core" DB, create an object store for profiles,
// and implement save/load for UserProfile + CameraProfile (plan.md section 15).
export function openProfileStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      // TODO(B): create object stores here
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
