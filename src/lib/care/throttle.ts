/**
 * Generic route throttling — server-only.
 *
 * A fixed-window counter per (scope, client key) persisted through the active
 * driver, so the limit holds across serverless instances when Redis is
 * configured. Without Redis the bucket is process-local — still a real speed
 * bump on a warm instance, but explicitly NOT a distributed guarantee, which is
 * why `/api/health` reports the active driver.
 *
 * Only a SHA-256 of the client key is persisted. Raw IPs never reach the store.
 */
import { hashToken } from "./crypto";
import { getDriver, CareKeys as K } from "./store";

export interface ThrottlePolicy {
  /** Allowed hits inside the window. */
  limit: number;
  windowMs: number;
}

export interface ThrottleStatus {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

function readBucket(raw: unknown): Bucket | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<Bucket>;
  if (!Number.isFinite(value.count) || !Number.isFinite(value.resetAt)) return null;
  return { count: value.count as number, resetAt: value.resetAt as number };
}

function bucketDocKey(scope: string, key: string): string {
  return K.rateLimit(scope, hashToken(key));
}

/** Read-only check; never extends the window. */
export async function checkThrottle(
  scope: string,
  key: string,
  policy: ThrottlePolicy,
  now = Date.now()
): Promise<ThrottleStatus> {
  const driver = await getDriver();
  const bucket = readBucket(await driver.getDoc(bucketDocKey(scope, key)));
  if (!bucket || bucket.resetAt <= now) {
    return { allowed: true, remaining: policy.limit, retryAfterMs: 0 };
  }
  const remaining = Math.max(0, policy.limit - bucket.count);
  return {
    allowed: remaining > 0,
    remaining,
    retryAfterMs: remaining > 0 ? 0 : bucket.resetAt - now,
  };
}

/** Count one hit. The read-modify-write is atomic per driver. */
export async function recordThrottleHit(
  scope: string,
  key: string,
  policy: ThrottlePolicy,
  now = Date.now()
): Promise<void> {
  const driver = await getDriver();
  await driver.mutateDoc<Bucket>(bucketDocKey(scope, key), (current) => {
    if (!current || !Number.isFinite(current.resetAt) || current.resetAt <= now) {
      return { count: 1, resetAt: now + policy.windowMs };
    }
    const count = Number.isFinite(current.count) ? current.count : 0;
    return { count: count + 1, resetAt: current.resetAt };
  });
}

/** Clear the bucket (used by tests). */
export async function clearThrottle(scope: string, key: string): Promise<void> {
  const driver = await getDriver();
  await driver.del(bucketDocKey(scope, key));
}
