/**
 * Persistent store for the Web Voice Call — Demo.
 *
 * Vercel Functions do not share memory between invocations or regions, so all
 * session state, events, transcripts, signalling and reports are persisted
 * through this module. Three interchangeable drivers:
 *
 *  - `redis`  : Upstash Redis over REST. Required on Vercel. Cross-instance safe
 *               (append-only lists for events/transcripts/signalling).
 *  - `file`   : a single JSON document under CARE_DATA_DIR. Local dev only.
 *  - `memory` : process-local. Tests + last-resort fallback (NOT multi-device).
 *
 * The driver selection is reported honestly to the UI so nobody mistakes a
 * non-persistent fallback for a working deployment.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { getRedis } from "@/lib/redis";

export type DriverName = "redis" | "file" | "memory";

export interface KVDriver {
  readonly name: DriverName;
  readonly persistent: boolean;
  /**
   * False once this process has observed a failed durable write (Redis quota
   * exhausted, network error). Callers that need to know whether a write will
   * survive a cold start or reach another instance (e.g. auth cookies) can use
   * this to fall back to a self-validating token instead of failing.
   */
  readonly writable: boolean;
  getDoc(key: string): Promise<unknown | null>;
  setDoc(key: string, value: unknown): Promise<void>;
  /** Set only when the key is absent. Returns true when this call wrote it. */
  setDocIfAbsent(key: string, value: unknown): Promise<boolean>;
  /** Atomically add to a numeric counter and return the new value. */
  incr(key: string, by?: number): Promise<number>;
  /**
   * Atomically read-modify-write one document. The mutator must be synchronous
   * and return `null` to abort without writing (used for compare-and-set).
   */
  mutateDoc<T>(key: string, mutate: (current: T | null) => T | null): Promise<T | null>;
  appendList(key: string, value: unknown, cap?: number): Promise<number>;
  getList(key: string, from?: number): Promise<unknown[]>;
  setList(key: string, values: unknown[]): Promise<void>;
  del(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// memory driver
// ---------------------------------------------------------------------------

class MemoryDriver implements KVDriver {
  readonly name = "memory" as const;
  readonly persistent = false;
  readonly writable = true;
  private docs = new Map<string, unknown>();
  private lists = new Map<string, unknown[]>();

  hasDoc(key: string) {
    return this.docs.has(key);
  }
  hasList(key: string) {
    return this.lists.has(key);
  }
  /** True when either a document or a list exists under this key. */
  has(key: string) {
    return this.docs.has(key) || this.lists.has(key);
  }
  async getDoc(key: string) {
    return this.docs.get(key) ?? null;
  }
  async setDoc(key: string, value: unknown) {
    this.docs.set(key, value);
  }
  async setDocIfAbsent(key: string, value: unknown) {
    if (this.docs.has(key) || this.lists.has(key)) return false;
    this.docs.set(key, value);
    return true;
  }
  async incr(key: string, by = 1) {
    const current = Number(this.docs.get(key) ?? 0);
    const next = (Number.isFinite(current) ? current : 0) + by;
    this.docs.set(key, next);
    return next;
  }
  async mutateDoc<T>(key: string, mutate: (current: T | null) => T | null): Promise<T | null> {
    // JavaScript runs this critical section without yielding: read, mutate and
    // write happen in one tick, so concurrent requests cannot interleave.
    const current = (this.docs.get(key) ?? null) as T | null;
    const next = mutate(current);
    if (next === null) return null;
    this.docs.set(key, next);
    return next;
  }
  async appendList(key: string, value: unknown, cap = 5000) {
    const list = this.lists.get(key) ?? [];
    list.push(value);
    if (list.length > cap) list.splice(0, list.length - cap);
    this.lists.set(key, list);
    return list.length;
  }
  async getList(key: string, from = 0) {
    return (this.lists.get(key) ?? []).slice(from);
  }
  async setList(key: string, values: unknown[]) {
    this.lists.set(key, [...values]);
  }
  async del(key: string) {
    this.docs.delete(key);
    this.lists.delete(key);
  }
}

// ---------------------------------------------------------------------------
// file driver (single JSON document, serialised writes)
// ---------------------------------------------------------------------------

interface FileShape {
  docs: Record<string, unknown>;
  lists: Record<string, unknown[]>;
}

function resolveDataDir(): string {
  const fromEnv = process.env.CARE_DATA_DIR;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  // Local dev: keep artifacts beside the project, never on a network share.
  return path.join(process.cwd(), ".care-data");
}

class FileDriver implements KVDriver {
  readonly name = "file" as const;
  readonly persistent = true;
  readonly writable = true;
  private file: string;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(dir: string) {
    this.file = path.join(dir, "care-store.json");
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async read(): Promise<FileShape> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as Partial<FileShape>;
      return { docs: parsed.docs ?? {}, lists: parsed.lists ?? {} };
    } catch {
      return { docs: {}, lists: {} };
    }
  }

  private async write(data: FileShape): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data), "utf8");
    await fs.rename(tmp, this.file);
  }

  async getDoc(key: string) {
    return this.run(async () => (await this.read()).docs[key] ?? null);
  }
  async setDoc(key: string, value: unknown) {
    await this.run(async () => {
      const data = await this.read();
      data.docs[key] = value;
      await this.write(data);
    });
  }
  async setDocIfAbsent(key: string, value: unknown) {
    return this.run(async () => {
      const data = await this.read();
      if (key in data.docs || key in data.lists) return false;
      data.docs[key] = value;
      await this.write(data);
      return true;
    });
  }
  async incr(key: string, by = 1) {
    return this.run(async () => {
      const data = await this.read();
      const current = Number(data.docs[key] ?? 0);
      const next = (Number.isFinite(current) ? current : 0) + by;
      data.docs[key] = next;
      await this.write(data);
      return next;
    });
  }
  async mutateDoc<T>(key: string, mutate: (current: T | null) => T | null): Promise<T | null> {
    return this.run(async () => {
      const data = await this.read();
      const current = (data.docs[key] ?? null) as T | null;
      const next = mutate(current);
      if (next === null) return null;
      data.docs[key] = next;
      await this.write(data);
      return next;
    });
  }
  async appendList(key: string, value: unknown, cap = 5000) {
    return this.run(async () => {
      const data = await this.read();
      const list = data.lists[key] ?? [];
      list.push(value);
      if (list.length > cap) list.splice(0, list.length - cap);
      data.lists[key] = list;
      await this.write(data);
      return list.length;
    });
  }
  async getList(key: string, from = 0) {
    return this.run(async () => ((await this.read()).lists[key] ?? []).slice(from));
  }
  async setList(key: string, values: unknown[]) {
    await this.run(async () => {
      const data = await this.read();
      data.lists[key] = [...values];
      await this.write(data);
    });
  }
  async del(key: string) {
    await this.run(async () => {
      const data = await this.read();
      delete data.docs[key];
      delete data.lists[key];
      await this.write(data);
    });
  }
}

// ---------------------------------------------------------------------------
// redis driver (Upstash REST)
// ---------------------------------------------------------------------------

interface RedisLike {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, opts?: { nx?: boolean; px?: number }): Promise<unknown>;
  incrby(key: string, by: number): Promise<number>;
  rpush(key: string, ...values: unknown[]): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<unknown[]>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** How long immutable chart data is cached in-process to save Redis commands. */
const READ_CACHE_TTL_MS = 20_000;
const READ_CACHE_MAX = 2_000;

/**
 * Patient profiles and records change rarely but are read on every portal
 * poll. Caching them briefly cuts the largest source of Upstash commands
 * without affecting live readings, links or events.
 */
function cacheableKey(key: string): boolean {
  return (
    key === "care:patient:index" ||
    key === "care:records" ||
    key === "care:seed:v1" ||
    key.startsWith("care:patient:") ||
    key.startsWith("care:record:") ||
    key.startsWith("care:records:")
  );
}

/**
 * Upstash Redis driver with an in-process safety net.
 *
 * A free Upstash database answers reads but rejects writes once the monthly
 * command quota is exhausted (`ERR max requests limit exceeded`). Without a
 * fallback every link, login, audit entry and device reading becomes a 500 and
 * the browser call loses the selected patient mid-demo.
 *
 * When a write fails we mark the driver degraded and keep writes in a
 * process-local overlay. Reads check the overlay first, then Redis, so the
 * chart data already in Redis remains available and newly linked patients /
 * fresh readings are immediately visible to this instance. Ops are retried
 * against Redis after a restart (new process), which is when quota may have
 * reset. This is deliberately a demo-grade safety net, not a replacement for a
 * paid shared store.
 */
class RedisDriver implements KVDriver {
  readonly name = "redis" as const;
  readonly persistent = true;
  get writable(): boolean {
    return !this.degraded;
  }
  private overlay = new MemoryDriver();
  private degraded = false;
  /** Keys deleted while degraded; keeps them hidden from Redis reads. */
  private deleted = new Set<string>();
  private readCache = new Map<string, { at: number; value: unknown }>();

  constructor(private redis: RedisLike) {}

  private degrade(): void {
    this.degraded = true;
  }

  private cacheGet(key: string): { hit: boolean; value: unknown } {
    if (!cacheableKey(key)) return { hit: false, value: null };
    const entry = this.readCache.get(key);
    if (!entry) return { hit: false, value: null };
    if (Date.now() - entry.at > READ_CACHE_TTL_MS) {
      this.readCache.delete(key);
      return { hit: false, value: null };
    }
    return { hit: true, value: entry.value };
  }

  private cacheSet(key: string, value: unknown): void {
    if (!cacheableKey(key)) return;
    this.readCache.set(key, { at: Date.now(), value });
    if (this.readCache.size <= READ_CACHE_MAX) return;
    const oldest = this.readCache.keys().next().value as string | undefined;
    if (oldest !== undefined) this.readCache.delete(oldest);
  }

  private invalidate(key: string): void {
    this.readCache.delete(key);
    // A new/changed patient or record must invalidate the index that lists it.
    if (key.startsWith("care:patient:")) this.readCache.delete("care:patient:index");
    if (key.startsWith("care:record:")) this.readCache.delete("care:records");
  }

  private async rememberDoc(key: string, value: unknown): Promise<void> {
    this.deleted.delete(key);
    await this.overlay.setDoc(key, value);
    this.invalidate(key);
  }

  async getDoc(key: string) {
    if (this.deleted.has(key)) return null;
    if (this.overlay.hasDoc(key)) return this.overlay.getDoc(key);
    const cached = this.cacheGet(key);
    if (cached.hit) return cached.value;
    try {
      const value = (await this.redis.get(key)) ?? null;
      this.cacheSet(key, value);
      return value;
    } catch {
      // A malformed value or a transient REST failure must not take the whole
      // request down; callers treat this as "missing" and regenerate state.
      return null;
    }
  }
  async setDoc(key: string, value: unknown) {
    if (this.degraded) {
      await this.rememberDoc(key, value);
      return;
    }
    try {
      await this.redis.set(key, value);
      this.deleted.delete(key);
      this.invalidate(key);
    } catch {
      this.degrade();
      await this.rememberDoc(key, value);
    }
  }
  async setDocIfAbsent(key: string, value: unknown) {
    if (this.degraded) return this.setIfAbsentLocal(key, value);
    try {
      const res = await this.redis.set(key, value, { nx: true });
      const wrote = res !== null && res !== undefined;
      if (wrote) {
        this.deleted.delete(key);
        this.invalidate(key);
      }
      return wrote;
    } catch {
      this.degrade();
      return this.setIfAbsentLocal(key, value);
    }
  }
  private async setIfAbsentLocal(key: string, value: unknown): Promise<boolean> {
    if (this.deleted.has(key)) {
      await this.rememberDoc(key, value);
      return true;
    }
    if (this.overlay.has(key)) return false;
    if ((await this.getDoc(key)) !== null) return false;
    if ((await this.getList(key)).length > 0) return false;
    await this.rememberDoc(key, value);
    return true;
  }
  async incr(key: string, by = 1) {
    if (this.degraded) return this.incrLocal(key, by);
    try {
      const next = await this.redis.incrby(key, by);
      this.deleted.delete(key);
      this.invalidate(key);
      return next;
    } catch {
      this.degrade();
      return this.incrLocal(key, by);
    }
  }
  private async incrLocal(key: string, by: number): Promise<number> {
    const current = this.deleted.has(key)
      ? 0
      : Number((this.overlay.hasDoc(key) ? await this.overlay.getDoc(key) : await this.getDoc(key)) ?? 0);
    const next = (Number.isFinite(current) ? current : 0) + by;
    await this.rememberDoc(key, next);
    return next;
  }
  async mutateDoc<T>(key: string, mutate: (current: T | null) => T | null): Promise<T | null> {
    if (this.degraded) return this.mutateLocal(key, mutate);
    // Upstash REST has no WATCH/MULTI transaction primitive exposed through the
    // driver interface, so guard the read-modify-write with a short-lived
    // distributed lock. The mutation itself runs in well under a millisecond.
    const lockKey = `${key}:__mutate_lock`;
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let locked = false;
    try {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const got = await this.redis.set(lockKey, token, { nx: true, px: 5000 });
        if (got !== null && got !== undefined) {
          locked = true;
          break;
        }
        await sleep(10 + Math.min(attempt, 20) * 3);
      }
    } catch {
      this.degrade();
      return this.mutateLocal(key, mutate);
    }
    if (!locked) {
      this.degrade();
      return this.mutateLocal(key, mutate);
    }
    try {
      let current: T | null;
      try {
        current = (await this.redis.get(key)) as T | null;
      } catch {
        this.degrade();
        return this.mutateLocal(key, mutate);
      }
      const next = mutate(current);
      if (next === null) return null;
      try {
        await this.redis.set(key, next);
        this.deleted.delete(key);
        this.invalidate(key);
        return next;
      } catch {
        this.degrade();
        await this.rememberDoc(key, next);
        return next;
      }
    } finally {
      try {
        if ((await this.redis.get(lockKey)) === token) await this.redis.del(lockKey);
      } catch {
        // The lock expires on its own (5s) if the release call fails.
      }
    }
  }
  private async mutateLocal<T>(key: string, mutate: (current: T | null) => T | null): Promise<T | null> {
    const current = (this.deleted.has(key)
      ? null
      : this.overlay.hasDoc(key)
        ? await this.overlay.getDoc(key)
        : await this.getDoc(key)) as T | null;
    const next = mutate(current);
    if (next === null) return null;
    await this.rememberDoc(key, next);
    return next;
  }
  async appendList(key: string, value: unknown, cap = 5000) {
    if (this.degraded) return this.appendListLocal(key, value, cap, false);
    let pushed = false;
    try {
      const len = await this.redis.rpush(key, value);
      pushed = true;
      if (len > cap) await this.redis.ltrim(key, len - cap, -1);
      this.deleted.delete(key);
      this.invalidate(key);
      return len;
    } catch {
      this.degrade();
      return this.appendListLocal(key, value, cap, pushed);
    }
  }
  private async appendListLocal(key: string, value: unknown, cap: number, alreadyPushed: boolean) {
    if (!this.overlay.hasList(key)) {
      const existing = this.deleted.has(key) ? [] : await this.readListFromRedis(key);
      await this.overlay.setList(key, existing);
    }
    this.deleted.delete(key);
    if (alreadyPushed) {
      // The push reached Redis; only the trim may have failed.
      const list = await this.overlay.getList(key);
      if (list.length > cap) await this.overlay.setList(key, list.slice(list.length - cap));
    } else {
      await this.overlay.appendList(key, value, cap);
    }
    this.invalidate(key);
    return (await this.overlay.getList(key)).length;
  }
  private async readListFromRedis(key: string): Promise<unknown[]> {
    try {
      const list = await this.redis.lrange(key, 0, -1);
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }
  async getList(key: string, from = 0) {
    if (this.deleted.has(key)) return [];
    if (this.overlay.hasList(key)) return this.overlay.getList(key, from);
    if (from === 0) {
      const cached = this.cacheGet(key);
      if (cached.hit) return Array.isArray(cached.value) ? cached.value : [];
    }
    try {
      const list = await this.redis.lrange(key, from, -1);
      const values = Array.isArray(list) ? list : [];
      if (from === 0) this.cacheSet(key, values);
      return values;
    } catch {
      return [];
    }
  }
  async setList(key: string, values: unknown[]) {
    if (this.degraded) {
      this.deleted.delete(key);
      await this.overlay.setList(key, values);
      this.invalidate(key);
      return;
    }
    try {
      await this.redis.del(key);
      if (values.length) await this.redis.rpush(key, ...values);
      this.deleted.delete(key);
      this.invalidate(key);
    } catch {
      this.degrade();
      this.deleted.delete(key);
      await this.overlay.setList(key, values);
      this.invalidate(key);
    }
  }
  async del(key: string) {
    if (this.degraded) {
      await this.overlay.del(key);
      this.deleted.add(key);
      this.invalidate(key);
      return;
    }
    try {
      await this.redis.del(key);
      this.deleted.delete(key);
      this.invalidate(key);
    } catch {
      this.degrade();
      await this.overlay.del(key);
      this.deleted.add(key);
      this.invalidate(key);
    }
  }
}

// ---------------------------------------------------------------------------
// driver selection (singleton per process)
// ---------------------------------------------------------------------------

let cached: KVDriver | null = null;

export async function getDriver(): Promise<KVDriver> {
  if (cached) return cached;
  const forced = (process.env.CARE_STORE ?? "").toLowerCase();

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const redisConfigured = Boolean(url && token) && forced !== "file" && forced !== "memory";

  if (redisConfigured) {
    try {
      const redis = getRedis() as unknown as RedisLike;
      cached = new RedisDriver(redis);
      return cached;
    } catch {
      // fall through to a non-persistent driver, flagged to the UI.
    }
  }

  if (forced === "memory" || process.env.NODE_ENV === "test") {
    cached = new MemoryDriver();
    return cached;
  }

  // On Vercel the project filesystem is read-only, so a file store cannot work.
  // Without Redis we degrade to memory and the UI reports persistence honestly.
  if (process.env.VERCEL && !process.env.CARE_DATA_DIR) {
    cached = new MemoryDriver();
    return cached;
  }

  cached = new FileDriver(resolveDataDir());
  return cached;
}

/** Test hook: reset the singleton between cases. */
export function resetDriverForTests(): void {
  cached = null;
}

// ---------------------------------------------------------------------------
// typed key namespace
// ---------------------------------------------------------------------------

const K = {
  session: (id: string) => `care:session:${id}`,
  sessionIndex: "care:session:index",
  /** Monotonic event/transcript sequence counter for one session. */
  sessionSeq: (id: string) => `care:session:${id}:seq`,
  events: (id: string) => `care:session:${id}:events`,
  transcript: (id: string) => `care:session:${id}:transcript`,
  signal: (id: string, to: string) => `care:session:${id}:signal:${to}`,
  signalSeq: (id: string, to: string) => `care:session:${id}:signal-seq:${to}`,
  report: (id: string) => `care:report:${id}`,
  reportIndex: "care:report:index",
  audit: "care:audit",
  patient: (id: string) => `care:patient:${id}`,
  patientIndex: "care:patient:index",
  patientSeeded: "care:patient:seeded",
  patientSeedVersion: "care:patient:seed-version",
  patientDeleted: (id: string) => `care:patient:deleted:${id}`,
  tasks: "care:tasks",
  messages: "care:messages",
  record: (id: string) => `care:record:${id}`,
  recordIndex: "care:records",
  recordsSeed: "care:records:seed:v1",
  sessionLink: (session: string) => `care:sessionlink:${session}`,
  sessionUnlinked: (session: string) => `care:sessionunlinked:${session}`,
  aiCache: (hash: string) => `care:ai:cache:${hash}`,
  aiCacheIndex: "care:ai:cache:index",
  seed: "care:seed:v1",
  login: (hash: string) => `care:login:${hash}`,
  /** Hashed IP+username bucket for sign-in throttling (no raw PII at rest). */
  loginRate: (hash: string) => `care:loginrate:${hash}`,
  /** Hashed, scope-namespaced bucket for generic route throttling. */
  rateLimit: (scope: string, hash: string) => `care:rate:${scope}:${hash}`,
  joinToken: (hash: string) => `care:jointoken:${hash}`,
  participant: (hash: string) => `care:participant:${hash}`,
  /** Persisted QR pairing token (uppercase session key), survives restarts. */
  pair: (session: string) => `care:pair:${session}`,
};

export { K as CareKeys };
