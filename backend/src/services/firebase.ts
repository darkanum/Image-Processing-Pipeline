import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";
import { getEnv, isEmulatorMode } from "../config/env.js";
import { logger } from "../utils/logger.js";

/**
 * Firebase Admin SDK bootstrap.
 *
 * - In emulator mode: connects to the local Firebase Emulator Suite (no creds needed).
 * - In production: uses GOOGLE_APPLICATION_CREDENTIALS / Application Default Credentials.
 *
 * Admin SDK automatically uses emulator host env vars (FIRESTORE_EMULATOR_HOST, etc.),
 * so we only need to make sure the env vars are set before init().
 */

let app: App | null = null;
let firestore: Firestore | null = null;
let storage: Storage | null = null;

export const getFirebaseApp = (): App => {
  if (app) return app;
  const env = getEnv();
  const existing = getApps();
  if (existing.length > 0) {
    app = existing[0]!;
    return app;
  }

  if (isEmulatorMode()) {
    logger.info(
      { projectId: env.FIREBASE_PROJECT_ID },
      "Initializing Firebase Admin SDK against local emulators",
    );
    // Project id only — no credentials in emulator mode.
    app = initializeApp({ projectId: env.FIREBASE_PROJECT_ID });
  } else {
    logger.info(
      { projectId: env.FIREBASE_PROJECT_ID },
      "Initializing Firebase Admin SDK against production credentials",
    );
    // Use service account via GOOGLE_APPLICATION_CREDENTIALS, or ADC.
    const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (serviceAccountPath) {
      app = initializeApp({
        credential: cert(serviceAccountPath),
        projectId: env.FIREBASE_PROJECT_ID,
        storageBucket: env.FIREBASE_STORAGE_BUCKET,
      });
    } else {
      app = initializeApp({
        projectId: env.FIREBASE_PROJECT_ID,
        storageBucket: env.FIREBASE_STORAGE_BUCKET,
      });
    }
  }
  return app;
};

export const getDb = (): Firestore => {
  if (firestore) return firestore;
  firestore = getFirestore(getFirebaseApp());
  return firestore;
};

export const getBucket = (): Storage => {
  if (storage) return storage;
  storage = getStorage(getFirebaseApp());
  return storage;
};

/** Reset cached handles — used by tests. */
export const __resetFirebaseForTests = (): void => {
  app = null;
  firestore = null;
  storage = null;
};
