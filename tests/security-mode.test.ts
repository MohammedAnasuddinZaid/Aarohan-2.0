import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  demoCredentialsEnabled,
  demoEndpointsEnabled,
  isStrictSecurity,
  securityMode,
  securityPosture,
} from "@/lib/care/securityMode";

const KEYS = [
  "CARE_SECURITY_MODE",
  "CARE_DEMO_MODE",
  "CARESPEAK_DEVICE_TOKEN",
  "NEXT_PUBLIC_CARE_REMOTE_TTS",
  "CARE_NURSE_USER",
  "CARE_NURSE_PASS",
  "VERCEL",
  "VERCEL_ENV",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("securityMode", () => {
  it("defaults to demo when nothing is configured", () => {
    expect(securityMode()).toBe("demo");
    expect(isStrictSecurity()).toBe(false);
  });

  it("honours an explicit mode and is case/space insensitive", () => {
    process.env.CARE_SECURITY_MODE = "  STRICT ";
    expect(securityMode()).toBe("strict");
    process.env.CARE_SECURITY_MODE = "demo";
    expect(securityMode()).toBe("demo");
  });

  it("treats CARE_DEMO_MODE=0 as an alias for strict", () => {
    process.env.CARE_DEMO_MODE = "0";
    expect(securityMode()).toBe("strict");
    process.env.CARE_DEMO_MODE = "false";
    expect(securityMode()).toBe("strict");
  });

  it("ignores unparseable and enabling CARE_DEMO_MODE values", () => {
    process.env.CARE_DEMO_MODE = "banana";
    expect(securityMode()).toBe("demo");
    process.env.CARE_DEMO_MODE = "1";
    expect(securityMode()).toBe("demo");
  });

  it("lets an explicit strict win over CARE_DEMO_MODE=1", () => {
    process.env.CARE_SECURITY_MODE = "strict";
    process.env.CARE_DEMO_MODE = "1";
    expect(securityMode()).toBe("strict");
  });

  it("defaults a hosted deployment to strict", () => {
    process.env.VERCEL = "1";
    expect(securityMode()).toBe("strict");
    expect(isStrictSecurity()).toBe(true);
    expect(demoEndpointsEnabled()).toBe(false);
  });

  it("lets a hosted deployment explicitly opt into demo", () => {
    process.env.VERCEL = "1";
    process.env.CARE_SECURITY_MODE = "demo";
    expect(securityMode()).toBe("demo");
  });

  it("stays strict on a hosted deployment even when CARE_DEMO_MODE=1", () => {
    process.env.VERCEL = "1";
    process.env.CARE_DEMO_MODE = "1";
    expect(securityMode()).toBe("strict");
  });
});

describe("demo affordance gates", () => {
  it("opens demo endpoints and credentials only in demo mode", () => {
    expect(demoEndpointsEnabled()).toBe(true);
    expect(demoCredentialsEnabled()).toBe(true);

    process.env.CARE_SECURITY_MODE = "strict";
    expect(demoEndpointsEnabled()).toBe(false);
    expect(demoCredentialsEnabled()).toBe(false);
  });
});

describe("securityPosture", () => {
  it("reports demo mode with the open-endpoint warning and no secrets", () => {
    const posture = securityPosture();
    expect(posture.mode).toBe("demo");
    expect(posture.demoEndpoints).toBe(true);
    expect(posture.warnings.some((w) => w.includes("SECURITY_MODE=demo"))).toBe(true);
    // Warning text must never leak credential values.
    process.env.CARE_NURSE_PASS = "super-secret-value";
    expect(JSON.stringify(securityPosture())).not.toContain("super-secret-value");
  });

  it("reports strict mode and flags a missing device token", () => {
    process.env.CARE_SECURITY_MODE = "strict";
    process.env.CARE_NURSE_USER = "nurse";
    process.env.CARE_NURSE_PASS = "pw";
    const posture = securityPosture();
    expect(posture.mode).toBe("strict");
    expect(posture.demoEndpoints).toBe(false);
    expect(posture.demoCredentials).toBe(false);
    expect(posture.deviceTokenConfigured).toBe(false);
    expect(posture.warnings.some((w) => w.includes("device ingest is refused"))).toBe(true);
    expect(posture.warnings.some((w) => w.includes("Nurse credentials"))).toBe(false);
  });

  it("clears the device-token warning once a token is configured", () => {
    process.env.CARE_SECURITY_MODE = "strict";
    process.env.CARESPEAK_DEVICE_TOKEN = "device-token";
    expect(securityPosture().deviceTokenConfigured).toBe(true);
    expect(securityPosture().warnings.some((w) => w.includes("device ingest"))).toBe(false);
  });

  it("warns when remote TTS can send PHI to Google", () => {
    process.env.NEXT_PUBLIC_CARE_REMOTE_TTS = "1";
    const posture = securityPosture();
    expect(posture.remoteTtsEnabled).toBe(true);
    expect(posture.warnings.some((w) => w.includes("PHI"))).toBe(true);
  });

  it("keeps a trimmed-but-empty nurse user from counting as configured", () => {
    process.env.CARE_SECURITY_MODE = "strict";
    process.env.CARE_NURSE_USER = "   ";
    process.env.CARE_NURSE_PASS = "pw";
    expect(securityPosture().warnings.some((w) => w.includes("sign-in is disabled"))).toBe(true);
  });
});
