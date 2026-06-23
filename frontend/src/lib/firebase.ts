import { initializeApp, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage as getFbStorage, type FirebaseStorage, connectStorageEmulator } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "demo-api-key",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "demo-image-pipeline.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "demo-image-pipeline",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "demo-image-pipeline.appspot.com",
};

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;

export const getFirebaseApp = (): FirebaseApp => {
  if (!app) {
    app = initializeApp(firebaseConfig);

    // Connect to Firestore emulator when VITE_FIRESTORE_EMULATOR_HOST is set.
    // Browsers can't reach docker service names — they need localhost.
    const fsHost = import.meta.env.VITE_FIRESTORE_EMULATOR_HOST as string | undefined;
    if (fsHost && !window.location.hostname.includes("github")) {
      try {
        const [host, port] = fsHost.split(":");
        connectFirestoreEmulator(getDb(), host, Number(port ?? 8080));
        // eslint-disable-next-line no-console
        console.info(`[firebase] connected Firestore emulator at ${fsHost}`);
      } catch (e) {
        // already connected — ignore
      }
    }

    const stHost = import.meta.env.VITE_FIREBASE_STORAGE_EMULATOR_HOST as string | undefined;
    if (stHost) {
      try {
        const [host, port] = stHost.split(":");
        connectStorageEmulator(getStorage(), host, Number(port ?? 9199));
        // eslint-disable-next-line no-console
        console.info(`[firebase] connected Storage emulator at ${stHost}`);
      } catch {
        // already connected
      }
    }
  }
  return app;
};

export const getDb = (): Firestore => {
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
};

export const getStorage = (): FirebaseStorage => {
  if (!storage) storage = getFbStorage(getFirebaseApp());
  return storage;
};
