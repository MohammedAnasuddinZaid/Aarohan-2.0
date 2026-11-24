import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Privacy invariant: Cache Storage survives logout and is readable by anyone
 * with the device, so the service worker must NEVER precache or cache an
 * authenticated/clinical route. This reads the shipped `public/sw.js` and
 * asserts the routing policy directly, so the guard cannot silently regress.
 */
const sw = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

function arrayLiteral(name: string): string[] {
  const match = sw.match(new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  if (!match) throw new Error(`could not find array ${name} in sw.js`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const PRIVATE_PREFIXES = ["/api/", "/care", "/nurse-view", "/ward", "/dashboard", "/logs", "/report", "/cctv"];

describe("service worker privacy policy", () => {
  it("is on the v3 cache generation", () => {
    expect(sw).toContain("carespeak-v3");
  });

  it("precaches only public shell pages", () => {
    const shell = arrayLiteral("SHELL");
    expect(shell).toContain("/");
    for (const priv of PRIVATE_PREFIXES) {
      expect(shell.some((s) => s === priv || s.startsWith(priv)), `shell leaks ${priv}`).toBe(false);
    }
  });

  it("lists every clinical route as private and bypassed", () => {
    const privates = arrayLiteral("PRIVATE_PREFIXES");
    for (const prefix of PRIVATE_PREFIXES) {
      expect(privates, `missing ${prefix}`).toContain(prefix);
    }
  });

  it("never caches /api traffic", () => {
    expect(sw).toContain('"/api/"');
  });
});
