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
  pair?: string | null,
  options: { allowDemoUnregistered?: boolean } = {}
): Promise<SessionAccess> {
  const nurse = await nurseFromRequest(req);
  if (nurse) {
    return {
      allowed: true,
      actor: { role: nurse.role, userId: nurse.userId, displayName: nurse.displayName },
    };
  }
  // The portal (browser call) opts in: it must keep working for a demo session
  // even on a hosted deployment where the Upstash quota is exhausted, because
  // registration writes can no longer persist across serverless instances. Only
  // the portal passes allowDemoUnregistered; phone/qr, notify, sync and ingest
  // remain proof-gated on their own. An unregistered session id is treated as
  // an open demo bed; a registered one still requires its pair token or a nurse.
  if (options.allowDemoUnregistered) {
    const registered = await hasRegistrationPersistent(session);
    if (!registered) return { allowed: true };
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
  pair?: string | null,
  options: { requireProof?: boolean } = {}
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
  if (!registered) {
    if (options?.requireProof) {
      const nurse = await nurseFromRequest(req);
      if (nurse) {
        return {
          allowed: true,
          actor: { role: nurse.role, userId: nurse.userId, displayName: nurse.displayName },
        };
      }
      if (pair && (await verifyPairTokenPersistent(key, pair))) return { allowed: true };
      return { allowed: false };
    }
    return { allowed: true };
  }

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