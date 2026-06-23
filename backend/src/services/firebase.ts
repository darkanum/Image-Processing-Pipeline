import {
  cert,
  getApps,
  initializeApp,
  type App,
  type ServiceAccount,
} from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";
import * as admin from "firebase-admin";
import { generateEmulatorServiceAccount } from "../utils/emulatorServiceAccount.js";
import { getEnv, isEmulatorMode } from "../config/env.js";
import { logger } from "../utils/logger.js";

/**
 * Firebase Admin SDK bootstrap.
 *
 * - In emulator mode: connects to the local Firebase Emulator Suite.
 *   The emulator ignores auth tokens, but the Admin SDK still requires
 *   a parseable credential at init time (the Storage client constructs a
 *   long-lived OAuth client). We feed it a freshly-generated service-account
 *   object whose RSA key is functionally inert — the emulator doesn't verify
 *   signatures on incoming requests, so the key is never actually used.
 *
 * - In production: uses GOOGLE_APPLICATION_CREDENTIALS / Application Default
 *   Credentials, plus the configured storage bucket.
 */

let app: App | null = null;
let firestore: Firestore | null = null;
let storage: Storage | null = null;

const resolveBucket = (): string => {
  const env = getEnv();
  return env.FIREBASE_STORAGE_BUCKET ?? `${env.FIREBASE_PROJECT_ID}.appspot.com`;
};

export const getFirebaseApp = (): App => {
  if (app) return app;
  const env = getEnv();
  const existing = getApps();
  if (existing.length > 0) {
    app = existing[0]!;
    return app;
  }

  if (isEmulatorMode()) {
    const sa = generateEmulatorServiceAccount(env.FIREBASE_PROJECT_ID);
    logger.info(
      { projectId: env.FIREBASE_PROJECT_ID, bucket: resolveBucket() },
      "Initializing Firebase Admin SDK against local emulators (locally-generated service account)",
    );
    app = initializeApp({
      projectId: env.FIREBASE_PROJECT_ID,
      storageBucket: resolveBucket(),
      credential: cert(sa),
    });
  } else {
    logger.info(
      { projectId: env.FIREBASE_PROJECT_ID },
      "Initializing Firebase Admin SDK against production credentials",
    );
    const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (serviceAccountPath) {
      app = initializeApp({
        credential: cert(serviceAccountPath),
        projectId: env.FIREBASE_PROJECT_ID,
        storageBucket: resolveBucket(),
      });
    } else {
      app = initializeApp({
        projectId: env.FIREBASE_PROJECT_ID,
        storageBucket: resolveBucket(),
        credential: admin.credential.applicationDefault(),
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
