/**
 * Shared authorisation for session-scoped care endpoints (the nurse portal and
 * the emergency/demo call trigger). Server-only.
 *
 * Layered, weakest-to-strongest:
 *   1. a signed-in nurse cookie always works;
 *   2. a valid `pair` token from the patient's QR proves the caller scanned it.
 *
 * Note: a session id alone is NOT a capability. Pair tokens must be persisted in
 * the shared store so they survive instance recycling.
 */
import type { NextRequest } from "next/server";
import { nurseFromRequest } from "./auth";
import {
  hasRegistrationPersistent,
  verifyPairTokenPersistent,
} from "@/lib/server/pairing";

export interface SessionActor {
  role: string;
  userId: string;
  displayName: string;
}

export interface SessionAccess {
  allowed: boolean;
  actor?: SessionActor;
}

export async function authorizeSession(
  req: NextRequest,
  session: string,
  pair?: string | null
): Promise<SessionAccess> {
  const nurse = await nurseFromRequest(req);
  if (nurse) {
    return {
      allowed: true,
      actor: { role: nurse.role, userId: nurse.userId, displayName: nurse.displayName },
    };
  }
  if (pair && (await verifyPairTokenPersistent(session, pair))) return { allowed: true };
  return { allowed: false };
}

/*
 * Live-sync authorisation is deliberately backwards compatible for unpaired
 * demo consoles (emergency/CCTV pages that never render a QR), but once a bed
 * has registered a pairing token, a bare session id stops being a capability.
 *
 * Caching keeps the 500ms reconciliation poll from turning every request into
 * two Redis round-trips. Registration is cached for 30s (including negative
 * results, which is why a freshly paired bed can take up to 30s to become
 * strict); a verified pair is cached for 30s, and a rejected one for 3s.
 */
const REGISTRATION_TTL_MS = 30_000;
const PAIR_ALLOW_TTL_MS = 30_000;
const PAIR_DENY_TTL_MS = 3_000;
const MAX_CACHE_ENTRIES = 5_000;

const registrationCache = new Map<string, { at: number; registered: boolean }>();
const pairCache = new Map<string, { until: number; allowed: boolean }>();

function remember<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.set(key, value);
  if (map.size <= MAX_CACHE_ENTRIES) return;
  const oldest = map.keys().next().value as K | undefined;
  if (oldest !== undefined) map.delete(oldest);
}

export async function authorizeSyncSession(
  req: NextRequest,
  session: string,
  pair?: string | null
): Promise<SessionAccess> {
  const key = session.toUpperCase();
  const now = Date.now();

  const remembered = registrationCache.get(key);
  let registered: boolean;
  if (remembered && now - remembered.at < REGISTRATION_TTL_MS) {
    registered = remembered.registered;
  } else {
    registered = await hasRegistrationPersistent(key);
    remember(registrationCache, key, { at: now, registered });
  }
  if (!registered) return { allowed: true };

  if (!pair) return authorizeSession(req, key, null);

  const pairKey = `${key}|${pair}`;
  const verified = pairCache.get(pairKey);
  if (verified && verified.until > now) {
    return verified.allowed ? { allowed: true } : { allowed: false };
  }
  const access = await authorizeSession(req, key, pair);
  remember(pairCache, pairKey, {
    until: now + (access.allowed ? PAIR_ALLOW_TTL_MS : PAIR_DENY_TTL_MS),
    allowed: access.allowed,
  });
  return access;
}

/** Test hook: caches must not leak between cases. */
export function resetSessionAccessForTests(): void {
  registrationCache.clear();
  pairCache.clear();
}
