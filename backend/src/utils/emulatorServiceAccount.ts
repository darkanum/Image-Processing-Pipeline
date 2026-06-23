import {
  generateKeyPairSync,
  createHash,
  randomUUID,
} from "node:crypto";

/**
 * Shape accepted by `firebase-admin/app`'s `cert()` constructor.
 * Only the three core fields are required; the rest are for SDK bookkeeping
 * and the Storage emulator ignores them entirely.
 */
export interface EmulatorServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/**
 * Generate a local service-account object that is accepted by the Firebase
 * Admin SDK's cert() parser but never actually trusted by anything outside
 * the local emulator suite.
 *
 * The private key is a freshly-generated RSA-2048 key. The Firebase Emulator
 * Suite does not verify signatures on incoming requests, so this key is
 * functionally inert — its sole purpose is to satisfy cert() at init time.
 */
export const generateEmulatorServiceAccount = (
  projectId: string,
): EmulatorServiceAccount => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  // Build a deterministic key id so repeated calls don't churn unrelated state.
  const keyId = createHash("sha256").update(privateKey).digest("hex").slice(0, 40);
  const clientEmail = `firebase-emulator-sa@${projectId}.iam.gserviceaccount.com`;
  void keyId; // reserved for future use; SA validator doesn't read it
  void clientEmail;
  void randomUUID;

  return {
    projectId,
    clientEmail,
    privateKey,
  };
};
