import type { CameraProfile, MADProfile, UserProfile } from "../../core/types";

const DB_NAME = "posture-core";
const DB_VERSION = 1;
const PROFILE_STORE_NAME = "profiles";
const DEFAULT_PROFILE_KEY = "default";

export interface StoredProfiles {
  userProfile: UserProfile;
  cameraProfile: CameraProfile;
  madProfile?: MADProfile;
  lastCalibrationAt: number;
}

export function openProfileStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(PROFILE_STORE_NAME)) {
        database.createObjectStore(PROFILE_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveProfiles(profiles: StoredProfiles): Promise<void> {
  const database = await openProfileStore();

  try {
    await runProfileTransaction<void>(database, "readwrite", async (store) => {
      const request = store.put(profiles, DEFAULT_PROFILE_KEY);

      await requestToPromise(request);
    });
  } finally {
    database.close();
  }
}

export async function loadProfiles(): Promise<StoredProfiles | null> {
  const database = await openProfileStore();

  try {
    return await runProfileTransaction<StoredProfiles | null>(
      database,
      "readonly",
      async (store) => {
        const request = store.get(DEFAULT_PROFILE_KEY);
        const result = await requestToPromise<StoredProfiles | undefined>(
          request,
        );

        return result ?? null;
      },
    );
  } finally {
    database.close();
  }
}

function runProfileTransaction<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(PROFILE_STORE_NAME, mode);
    const store = transaction.objectStore(PROFILE_STORE_NAME);
    let operationResult: T;

    operation(store)
      .then((result) => {
        operationResult = result;
      })
      .catch((error: unknown) => {
        transaction.abort();
        reject(error);
      });

    transaction.oncomplete = () => resolve(operationResult);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
