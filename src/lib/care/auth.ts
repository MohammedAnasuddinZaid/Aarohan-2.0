/**
 * Auth for the Web Voice Call — Demo. Server-only.
 *
 * Nurse authentication is a signed-cookie session backed by the persistent store
 * (so it works across Vercel instances). Patient authorisation is a short-lived
 * participant token minted at join time. No credentials or secrets are ever sent
 * to the browser beyond opaque tokens.
 *
 * Credentials come from environment variables. For the hackathon a demo nurse is
 * available by default (see DEMO_CREDENTIALS_WARNING); change the env vars before
 * any real use.
 */
import type { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { hashToken, newToken, safeEqual } from "./crypto";
import { delLogin, getLogin, putLogin, type LoginRecord } from "./repo";
import { getDriver } from "./store";
import { demoCredentialsEnabled } from "./securityMode";

export const NURSE_COOKIE = "care_session";
export const PARTICIPANT_HEADER = "x-care-participant";

const SESSION_MINUTES = 8 * 60;

export const DEMO_CREDENTIALS_WARNING =
  "Using built-in demo credentials (nurse.demo). Set CARE_NURSE_USER / CARE_NURSE_PASS before real use.";

interface Credential {
  userId: string;
  username: string;
  password: string;
  displayName: string;
  role: "admin" | "nurse";
}

function credentials(): Credential[] {
  // Both halves must be set. Previously a configured username with an unset
  // password silently fell back to the literal "nurse.demo".
  const envUser = process.env.CARE_NURSE_USER?.trim();
  const envPass = process.env.CARE_NURSE_PASS;
  const configured = Boolean(envUser && envPass);
  if (!configured && !demoCredentialsEnabled()) return [];

  const list: Credential[] = [
    {
      userId: "nurse_1",
      username: configured ? envUser! : "nurse.demo",
      password: configured ? envPass! : "nurse.demo",
      displayName:
        process.env.CARE_NURSE_NAME || (configured ? "Nurse" : "Nurse Demo"),
      role: "nurse",
    },
  ];
  if (process.env.CARE_ADMIN_USER && process.env.CARE_ADMIN_PASS) {
    list.push({
      userId: "admin_1",
      username: process.env.CARE_ADMIN_USER,
      password: process.env.CARE_ADMIN_PASS,
      displayName: "Administrator",
      role: "admin",
    });
  }
  return list;
}

export interface LoginOutcome {
  token: string;
  record: LoginRecord;
}

// ---------------------------------------------------------------------------
// self-validating session tokens
//
// The persistent store can be read-only (Upstash quota exhausted) or split
// across serverless instances. A purely opaque token then fails to validate on
// every route except the one that minted it. To keep the nurse console usable
// in that state, every token also carries its own signed record; when the
// persistent store is unavailable we accept it without a lookup.
// ---------------------------------------------------------------------------
function sessionSecret(): Buffer {
  const explicit = process.env.CARE_SESSION_SECRET?.trim();
  const base =
    explicit ||
    [process.env.CARE_NURSE_USER, process.env.CARE_NURSE_PASS, process.env.CARE_ADMIN_USER, process.env.CARE_ADMIN_PASS]
      .filter(Boolean)
      .join("|") ||
    "carespeak-demo-session-secret";
  return Buffer.from(hashToken(`${base}|care-session-v1`), "hex");
}

function signPayload(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload, "utf8").digest("base64url");
}

function mintSessionToken(record: LoginRecord): string {
  const body = Buffer.from(
    JSON.stringify({
      v: 1,
      userId: record.userId,
      username: record.username,
      displayName: record.displayName,
      role: record.role,
      expiresAt: record.expiresAt,
      nonce: newToken().slice(0, 16),
    }),
    "utf8"
  ).toString("base64url");
  return `${body}.${signPayload(body)}`;
}

function readSessionToken(token: string): LoginRecord | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  if (!safeEqual(signPayload(body), sig)) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (parsed.v !== 1) return null;
  if (typeof parsed.userId !== "string" || typeof parsed.username !== "string") return null;
  if (typeof parsed.displayName !== "string") return null;
  if (parsed.role !== "admin" && parsed.role !== "nurse") return null;
  if (typeof parsed.expiresAt !== "string") return null;
  const expiresAt = Date.parse(parsed.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return {
    userId: parsed.userId,
    username: parsed.username,
    displayName: parsed.displayName,
    role: parsed.role,
    expiresAt: parsed.expiresAt,
  };
}

let storeWriteProbe: { at: number; unavailable: boolean } | null = null;
async function storeWritesUnavailable(): Promise<boolean> {
  const now = Date.now();
  if (storeWriteProbe && now - storeWriteProbe.at < 30_000) return storeWriteProbe.unavailable;
  let unavailable = false;
  try {
    const d = await getDriver();
    if (!d.writable) {
      unavailable = true;
    } else {
      await d.setDoc("care:login:probe", { at: new Date().toISOString() });
      unavailable = !d.writable;
    }
  } catch {
    unavailable = true;
  }
  storeWriteProbe = { at: now, unavailable };
  return unavailable;
}

export async function login(username: string, password: string): Promise<LoginOutcome | null> {
  const match = credentials().find((c) => c.username.toLowerCase() === username.trim().toLowerCase());
  if (!match) return null;
  if (!safeEqual(hashToken(password), hashToken(match.password))) return null;
  const record: LoginRecord = {
    userId: match.userId,
    username: match.username,
    displayName: match.displayName,
    role: match.role,
    expiresAt: new Date(Date.now() + SESSION_MINUTES * 60_000).toISOString(),
  };
  const token = mintSessionToken(record);
  await putLogin(hashToken(token), record);
  return { token, record };
}

export async function logout(token: string | null | undefined): Promise<void> {
  if (token) await delLogin(hashToken(token));
}

function cookieValue(req: NextRequest, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) {
      const value = v.join("=");
      // A malformed percent escape in a cookie must not throw a 500 from every
      // route that reads the nurse session.
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}

export async function nurseFromRequest(req: NextRequest): Promise<LoginRecord | null> {
  const token = cookieValue(req, NURSE_COOKIE);
  if (!token) return null;
  const stored = await getLogin(hashToken(token));
  if (stored) return stored;
  // Only fall back to the self-validating token when the persistent store is
  // known to be unable to keep a session (quota exhausted / network error).
  // When writes work, a missing record means the session was logged out or has
  // expired, and we must not resurrect it from a copied cookie.
  if (!(await storeWritesUnavailable())) return null;
  return readSessionToken(token);
}

export interface ParticipantAuth {
  sessionId: string;
  role: "patient";
}

export async function participantFromRequest(req: NextRequest): Promise<string | null> {
  const header = req.headers.get(PARTICIPANT_HEADER);
  if (header) return header.trim();
  const auth = req.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return null;
}

export function buildSessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${NURSE_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
    SESSION_MINUTES * 60
  }${secure}`;
}

export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${NURSE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
