/**
 * Sign-in throttling — server-only.
 *
 * A shared counter per (client IP + username) makes password guessing
 * expensive across every serverless instance when Redis is configured. Without
 * Redis the bucket is process-local, which still stops naive scripted attacks
 * on a warm instance but is explicitly NOT a distributed guarantee; the health
 * endpoint already reports the active driver so operators can see the gap.
 *
 * Only a SHA-256 of `ip|username` is persisted. Raw addresses and usernames
 * never reach the store or the audit log.
 */
import { hashToken } from "./crypto";
import { getDriver, CareKeys as K } from "./store";

export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_MS = 15 * 60_000;

interface Bucket {
  count: number;
  resetAt: number;
}

export interface LoginRateStatus {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/** Best-effort client IP behind Vercel / common reverse proxies. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    headers.get("x-real-ip")?.trim() ||
    headers.get("cf-connecting-ip")?.trim() ||
    "local"
  );
}

/** Opaque bucket key. Changing the IP or username creates a separate bucket. */
export function loginRateKey(ip: string, username: string): string {
  return hashToken(`${ip}|${username.trim().toLowerCase()}`);
}

function readBucket(raw: unknown): Bucket | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<Bucket>;
  if (!Number.isFinite(value.count) || !Number.isFinite(value.resetAt)) return null;
  return { count: value.count as number, resetAt: value.resetAt as number };
}

/** Read-only check; never extends the window. */
export async function peekLoginRateLimit(
  key: string,
  now = Date.now()
): Promise<LoginRateStatus> {
  const driver = await getDriver();
  const bucket = readBucket(await driver.getDoc(K.loginRate(key)));
  if (!bucket || bucket.resetAt <= now) {
    return { allowed: true, remaining: LOGIN_MAX_ATTEMPTS, retryAfterMs: 0 };
  }
  const remaining = Math.max(0, LOGIN_MAX_ATTEMPTS - bucket.count);
  return {
    allowed: remaining > 0,
    remaining,
    retryAfterMs: remaining > 0 ? 0 : bucket.resetAt - now,
  };
}

/**
 * Count one failed credential check. The read-modify-write is atomic per
 * driver, so two concurrent failures cannot both write `count = 1`.
 */
export async function recordLoginFailure(key: string, now = Date.now()): Promise<void> {
  const driver = await getDriver();
  await driver.mutateDoc<Bucket>(K.loginRate(key), (current) => {
    if (!current || !Number.isFinite(current.resetAt) || current.resetAt <= now) {
      return { count: 1, resetAt: now + LOGIN_WINDOW_MS };
    }
    const count = Number.isFinite(current.count) ? current.count : 0;
    return { count: count + 1, resetAt: current.resetAt };
  });
}

/** A successful sign-in clears the failure history for that bucket. */
export async function clearLoginRateLimit(key: string): Promise<void> {
  const driver = await getDriver();
  await driver.del(K.loginRate(key));
}
