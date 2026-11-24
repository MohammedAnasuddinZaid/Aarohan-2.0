/**
 * Deployment security posture — server-only.
 *
 * CareSpeak ships two modes:
 *
 *  - `demo` (default): keeps the hackathon experience alive. The ward board,
 *    the escalation dispatcher and tokenless device ingest work without a
 *    login, and the seeded nurse.demo account is available.
 *  - `strict`: required for any real patient data. Demo credentials are
 *    refused, ward/notify require a nurse session, device ingest requires a
 *    token, LAN discovery is disabled, and the sync data plane requires proof
 *    of pairing.
 *
 * Precedence, in order:
 *   1. `CARE_SECURITY_MODE=strict|demo` — always wins.
 *   2. `CARE_DEMO_MODE=0` — strict.
 *   3. A hosted deployment (`VERCEL` set) — strict. The demo affordances assume
 *      the app runs on the nurse's own machine; on a public URL the same
 *      endpoints (ward, notify, ingest, sync) are reachable by anyone, so the
 *      safe default is the closed one. A deliberate public demo must opt back in
 *      with `CARE_SECURITY_MODE=demo`.
 *   4. Otherwise — demo (local development).
 *
 * This is why NODE_ENV is deliberately not consulted: a *hosted demo* and a
 * *local production-ish* box must be distinguished by intent, not by a value
 * Next.js sets for every production build. `/api/health` reports the active mode
 * and every remaining demo affordance so a deployment can be checked from
 * outside without guessing.
 */

export type SecurityMode = "demo" | "strict";

function flag(value: string | undefined): boolean | null {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return null;
}

/** True when running on a managed host (Vercel) rather than a local machine. */
export function isHostedDeployment(): boolean {
  return Boolean(process.env.VERCEL) || process.env.VERCEL_ENV === "production";
}

export function securityMode(): SecurityMode {
  const explicit = (process.env.CARE_SECURITY_MODE ?? "").trim().toLowerCase();
  if (explicit === "strict") return "strict";
  if (explicit === "demo") return "demo";
  // `CARE_DEMO_MODE=0` is accepted as an alias because operators reasonably
  // reach for it after seeing the demo warnings.
  if (flag(process.env.CARE_DEMO_MODE) === false) return "strict";
  // A hosted deployment has no "nurse's own machine" trust boundary.
  if (isHostedDeployment()) return "strict";
  return "demo";
}

export function isStrictSecurity(): boolean {
  return securityMode() === "strict";
}

/** Open demo endpoints (ward, notify without a login, tokenless ingest). */
export function demoEndpointsEnabled(): boolean {
  return !isStrictSecurity();
}

/** The seeded nurse.demo account is only available outside strict mode. */
export function demoCredentialsEnabled(): boolean {
  return !isStrictSecurity();
}

export interface SecurityPosture {
  mode: SecurityMode;
  demoEndpoints: boolean;
  demoCredentials: boolean;
  deviceTokenConfigured: boolean;
  remoteTtsEnabled: boolean;
  warnings: string[];
}

/**
 * Public, secret-free summary for `/api/health`. Warning text names the missing
 * setting, never its value.
 */
export function securityPosture(): SecurityPosture {
  const mode = securityMode();
  const deviceTokenConfigured = Boolean(process.env.CARESPEAK_DEVICE_TOKEN);
  const remoteTtsEnabled = process.env.NEXT_PUBLIC_CARE_REMOTE_TTS === "1";
  const nurseConfigured = Boolean(
    process.env.CARE_NURSE_USER?.trim() && process.env.CARE_NURSE_PASS
  );
  const warnings: string[] = [];

  if (mode === "demo") {
    warnings.push(
      isHostedDeployment()
        ? "SECURITY_MODE=demo was explicitly set on a hosted deployment: ward data, escalation dispatch and tokenless device ingest are open on a public URL. Remove CARE_SECURITY_MODE=demo before real patient use."
        : "SECURITY_MODE=demo: ward data, escalation dispatch and tokenless device ingest are open. Set CARE_SECURITY_MODE=strict before real patient use."
    );
  }
  if (!nurseConfigured) {
    warnings.push(
      mode === "strict"
        ? "No nurse credentials configured: sign-in is disabled until CARE_NURSE_USER and CARE_NURSE_PASS are both set."
        : "Built-in nurse.demo credentials are active. Set CARE_NURSE_USER and CARE_NURSE_PASS."
    );
  }
  if (!deviceTokenConfigured) {
    warnings.push(
      mode === "strict"
        ? "CARESPEAK_DEVICE_TOKEN is not set: device ingest is refused in strict mode."
        : "CARESPEAK_DEVICE_TOKEN is not set: device ingest accepts unauthenticated demo traffic."
    );
  }
  if (remoteTtsEnabled) {
    warnings.push(
      "NEXT_PUBLIC_CARE_REMOTE_TTS=1: text without a local voice is sent to Google translate_tts. That text can contain PHI."
    );
  }

  return {
    mode,
    demoEndpoints: demoEndpointsEnabled(),
    demoCredentials: demoCredentialsEnabled(),
    deviceTokenConfigured,
    remoteTtsEnabled,
    warnings,
  };
}
