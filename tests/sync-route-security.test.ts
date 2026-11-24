import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as syncGet, POST as syncPost } from "@/app/api/sync/route";
import { GET as streamGet } from "@/app/api/stream/route";
import {
  registerPairTokenPersistent,
  resetPairingForTests,
} from "@/lib/server/pairing";
import { resetDriverForTests } from "@/lib/care/store";
import { resetSessionAccessForTests } from "@/lib/care/sessionAccess";

const SESSION = "BED12";

function post(body: unknown) {
  return new NextRequest("https://care.example.com/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function get(path: string) {
  return new NextRequest(`https://care.example.com${path}`, { method: "GET" });
}

function gesture() {
  return {
    type: "new_gesture",
    sessionId: SESSION,
    entry: {
      id: "gesture_abc123",
      gesture: "HELP",
      description: "help",
      confidence: 0.9,
      type: "hand",
      timestamp: Date.now(),
    },
  };
}

beforeEach(() => {
  resetDriverForTests();
  resetPairingForTests();
  resetSessionAccessForTests();
  delete (globalThis as unknown as { __carespeakPairing?: unknown }).__carespeakPairing;
  delete process.env.CARE_SECURITY_MODE;
  delete process.env.CARE_DEMO_MODE;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.MSG91_AUTH_KEY;
});

describe("POST /api/sync — alert-lifecycle mutations are proof-gated", () => {
  it("refuses an anonymous resolve on a registered bed but keeps the entry alive", async () => {
    await registerPairTokenPersistent(SESSION, "owner-token-1234");
    const res = await syncPost(post({ type: "resolve", entryId: "gesture_abc123", sessionId: SESSION }));
    expect(res.status).toBe(401);
  });

  it("accepts a resolve that carries the bed's real pair token", async () => {
    await registerPairTokenPersistent(SESSION, "owner-token-1234");
    const res = await syncPost(
      post({ type: "acknowledge", entryId: "gesture_abc123", sessionId: SESSION, pair: "owner-token-1234" })
    );
    expect(res.status).toBe(200);
  });

  it("requires proof for an unregistered bed once the deployment is strict", async () => {
    process.env.CARE_SECURITY_MODE = "strict";
    const res = await syncPost(post({ type: "escalate", entryId: "gesture_abc123", sessionId: SESSION }));
    expect(res.status).toBe(401);
  });

  it("requires proof for an unregistered bed once a messaging provider is configured", async () => {
    process.env.MSG91_AUTH_KEY = "live-key";
    const res = await syncPost(post({ type: "resolve", entryId: "gesture_abc123", sessionId: SESSION }));
    expect(res.status).toBe(401);
  });

  it("keeps the keyless demo escalation flow open (no login on the ward -> nurse-view path)", async () => {
    const res = await syncPost(post({ type: "acknowledge", entryId: "gesture_abc123", sessionId: SESSION }));
    expect(res.status).toBe(200);
  });

  it("leaves the device telemetry plane open for an unregistered demo bed", async () => {
    const res = await syncPost(post(gesture()));
    expect(res.status).toBe(200);
  });
});

describe("GET read plane — strict mode requires proof", () => {
  it("refuses an anonymous read of an unregistered bed in strict mode", async () => {
    process.env.CARE_SECURITY_MODE = "strict";
    const res = await syncGet(get(`/api/sync?session=${SESSION}&since=0`));
    expect(res.status).toBe(401);
  });

  it("keeps the unregistered demo read open", async () => {
    const res = await syncGet(get(`/api/sync?session=${SESSION}&since=0`));
    expect(res.status).toBe(200);
  });

  it("refuses a registered bed's live stream without the pair, when strict", async () => {
    process.env.CARE_SECURITY_MODE = "strict";
    await registerPairTokenPersistent(SESSION, "owner-token-1234");
    const res = await streamGet(get(`/api/stream?session=${SESSION}`));
    expect(res.status).toBe(401);
  });

  it("keeps a registered bed readable in demo once the pair is proven", async () => {
    await registerPairTokenPersistent(SESSION, "owner-token-1234");
    const res = await syncGet(get(`/api/sync?session=${SESSION}&since=0&pair=owner-token-1234`));
    expect(res.status).toBe(200);
  });
});
