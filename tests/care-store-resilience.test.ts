import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const docs = new Map<string, unknown>();
  const lists = new Map<string, unknown[]>();
  const flags = { writesFail: true };
  const redis = {
    async get(key: string) {
      return docs.get(key) ?? null;
    },
    async set(key: string, value: unknown, opts?: { nx?: boolean; px?: number }) {
      if (flags.writesFail) throw new Error("ERR max requests limit exceeded. Limit: 500000, Usage: 500000.");
      if (opts?.nx && (docs.has(key) || lists.has(key))) return null;
      docs.set(key, value);
      return "OK";
    },
    async incrby(key: string, by: number) {
      if (flags.writesFail) throw new Error("ERR max requests limit exceeded.");
      const current = Number(docs.get(key) ?? 0);
      const next = (Number.isFinite(current) ? current : 0) + by;
      docs.set(key, next);
      return next;
    },
    async rpush(key: string, ...values: unknown[]) {
      if (flags.writesFail) throw new Error("ERR max requests limit exceeded.");
      const list = lists.get(key) ?? [];
      for (const v of values) list.push(v);
      lists.set(key, list);
      return list.length;
    },
    async lrange(key: string, start: number, stop: number) {
      const list = lists.get(key) ?? [];
      const end = stop < 0 ? list.length + stop + 1 : stop + 1;
      return list.slice(start, end);
    },
    async ltrim(key: string, start: number, stop: number) {
      if (flags.writesFail) throw new Error("ERR max requests limit exceeded.");
      const list = lists.get(key) ?? [];
      const end = stop < 0 ? list.length + stop + 1 : stop + 1;
      lists.set(key, list.slice(start, end));
      return "OK";
    },
    async del(key: string) {
      if (flags.writesFail) throw new Error("ERR max requests limit exceeded.");
      docs.delete(key);
      lists.delete(key);
      return 1;
    },
  };
  return { docs, lists, flags, redis };
});

vi.mock("@/lib/redis", () => ({ getRedis: () => state.redis }));

import { getDriver, resetDriverForTests, CareKeys as K } from "@/lib/care/store";

beforeEach(() => {
  process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "token";
  delete process.env.CARE_STORE;
  resetDriverForTests();
  state.docs.clear();
  state.lists.clear();
  state.flags.writesFail = true;
});

afterEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  resetDriverForTests();
});

describe("resilient redis driver", () => {
  it("reports redis but degrades to writable=false on the first failed write", async () => {
    const d = await getDriver();
    expect(d.name).toBe("redis");
    expect(d.persistent).toBe(true);
    expect(d.writable).toBe(true);

    await d.setDoc("care:probe", { ok: true });
    expect(d.writable).toBe(false);
    expect(await d.getDoc("care:probe")).toEqual({ ok: true });
  });

  it("keeps writes readable within the process after the quota is exhausted", async () => {
    const d = await getDriver();
    await d.setDoc("care:sessionlink:TEST", { patientId: "pt_0001", sessionId: "TEST" });
    expect(await d.getDoc("care:sessionlink:TEST")).toMatchObject({ patientId: "pt_0001" });

    await d.setDoc("care:sessionlink:TEST", { patientId: "pt_0002", sessionId: "TEST" });
    expect(await d.getDoc("care:sessionlink:TEST")).toMatchObject({ patientId: "pt_0002" });
  });

  it("reads chart data that was already in redis before the quota ran out", async () => {
    state.docs.set("care:patient:pt_0001", { id: "pt_0001", displayName: "Anita Sharma" });
    state.docs.set("care:patient:index", ["pt_0001"]);
    const d = await getDriver();
    expect(await d.getDoc("care:patient:pt_0001")).toMatchObject({ displayName: "Anita Sharma" });
    // The first failed write degrades the driver; reads still reach redis.
    await d.setDoc("care:probe", 1);
    expect(await d.getDoc("care:patient:pt_0001")).toMatchObject({ displayName: "Anita Sharma" });
  });

  it("hides a key from redis reads after a failed delete", async () => {
    state.docs.set("care:sessionunlinked:TEST", true);
    const d = await getDriver();
    await d.setDoc("care:probe", 1); // degrade
    await d.del("care:sessionunlinked:TEST");
    expect(await d.getDoc("care:sessionunlinked:TEST")).toBeNull();
  });

  it("increments a counter starting from a redis value when writes are blocked", async () => {
    state.docs.set("care:counter", 4);
    const d = await getDriver();
    await d.setDoc("care:probe", 1); // degrade
    expect(await d.incr("care:counter")).toBe(5);
    expect(await d.incr("care:counter", 2)).toBe(7);
  });

  it("appends to a list copied from redis and keeps new entries", async () => {
    state.lists.set("care:audit", ["old"]);
    const d = await getDriver();
    await d.setDoc("care:probe", 1); // degrade
    await d.appendList("care:audit", "new", 5000);
    expect(await d.getList("care:audit")).toEqual(["old", "new"]);
  });

  it("setDocIfAbsent respects an existing redis key", async () => {
    state.docs.set("care:login:abc", { userId: "nurse_1" });
    const d = await getDriver();
    await d.setDoc("care:probe", 1); // degrade
    expect(await d.setDocIfAbsent("care:login:abc", { userId: "other" })).toBe(false);
    expect(await d.getDoc("care:login:abc")).toMatchObject({ userId: "nurse_1" });
  });
});