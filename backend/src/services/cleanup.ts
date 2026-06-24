import { getDb, getBucket } from "./firebase.js";
import { logger } from "../utils/logger.js";
import { getEnv } from "../config/env.js";

/**
 * Periodic cleanup of old Firestore documents and Storage objects.
 *
 * Runs every hour by default; deletes job records and result files
 * older than JOB_TTL_HOURS / STORAGE_TTL_HOURS. Run this as a single
 * instance in the cluster (or use a leader-election lock) so multiple
 * workers don't double-clean.
 */
export const startCleanupScheduler = (intervalMs = 60 * 60 * 1000): NodeJS.Timeout => {
  const run = async (): Promise<void> => {
    try {
      const env = getEnv();
      const cutoffMs = Date.now() - env.JOB_TTL_HOURS * 60 * 60 * 1000;

      const db = getDb();
      const snap = await db
        .collection("jobs")
        .where("createdAt", "<", cutoffMs)
        .limit(500)
        .get();
      if (snap.size > 0) {
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        logger.info({ count: snap.size, olderThanHours: env.JOB_TTL_HOURS }, "cleanup: deleted old job records");
      }

      // Storage cleanup: list results/ prefix and delete old files.
      // (Storage emulator supports the same GCS API surface.)
      const bucket = getBucket().bucket();
      const [files] = await bucket.getFiles({ prefix: "results/" });
      const cutoffIso = new Date(cutoffMs).toISOString();
      let deleted = 0;
      for (const f of files) {
        const [meta] = await f.getMetadata();
        const updated = meta.updated ?? "";
        if (updated && updated < cutoffIso) {
          await f.delete().catch(() => undefined);
          deleted += 1;
        }
      }
      if (deleted > 0) {
        logger.info({ count: deleted }, "cleanup: deleted old result files");
      }
    } catch (err) {
      logger.error({ err: (err as Error).message }, "cleanup: run failed (will retry)");
    }
  };

  // Don't run immediately on startup — give the service a moment to
  // become healthy. Then run once, then on interval.
  const t = setTimeout(() => {
    void run();
    setInterval(run, intervalMs);
  }, 30_000);
  return t;
};
