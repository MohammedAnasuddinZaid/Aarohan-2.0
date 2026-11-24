import { NextRequest, NextResponse } from "next/server";
import os from "node:os";
import { nurseFromRequest } from "@/lib/care/auth";
import { isStrictSecurity } from "@/lib/care/securityMode";

export const dynamic = "force-dynamic";

/**
 * LAN discovery for QR pairing.
 *
 * When the patient device is on localhost, a QR encoding http://localhost:3000
 * is useless for phones. This endpoint reports the host's private IPv4
 * addresses so the patient page can build a reachable `http://<lan-ip>:<port>`
 * pairing URL automatically — no `ipconfig` needed.
 *
 * Only RFC1918-style private ranges are returned first; loopback/link-local
 * and public IPs are excluded entirely (nothing sensitive leaves the machine).
 */
const PRIVATE_IPV4 = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/;

export async function GET(request: NextRequest): Promise<NextResponse> {
  // A hosted deployment has no LAN worth discovering, and the host name plus
  // interface list is needless internal detail on a public URL.
  if (process.env.VERCEL) {
    return NextResponse.json(
      { hostname: null, lan: [], hosted: true, serverTime: Date.now() },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  if (isStrictSecurity() && !(await nurseFromRequest(request))) {
    return NextResponse.json(
      { ok: false, error: "Sign in to discover local devices." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const interfaces = os.networkInterfaces();
  const lan: { name: string; address: string }[] = [];

  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] ?? []) {
      // Node 18+: family is a string ("IPv4"); older builds may use a number (4).
      const isV4 = net.family === "IPv4" || (net.family as unknown as number) === 4;
      if (!isV4 || net.internal) continue;
      if (!PRIVATE_IPV4.test(net.address)) continue;
      lan.push({ name, address: net.address });
    }
  }

  // Stable order: prefer 192.168.x (home/hospital Wi-Fi), then 10.x, then 172.x.
  lan.sort((a, b) => {
    const rank = (ip: string): number =>
      ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : 2;
    return rank(a.address) - rank(b.address);
  });

  return NextResponse.json(
    { hostname: os.hostname(), lan, serverTime: Date.now() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
