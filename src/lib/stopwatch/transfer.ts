/**
 * Pure encode/decode for the QR-code lap-transfer payload.
 *
 * Format (compact JSON, ~4–10 bytes per lap):
 *   { v, a, s, l: [[number, elapsedMs], ...] }
 *
 * - v: payload version (currently 1; bump for any structural change)
 * - a: activityId (UUID string)
 * - s: scoreKey ("score1"…"score6")
 * - l: array of [lap number, elapsed milliseconds] pairs
 *
 * Why JSON not raw binary: the size win of binary is small at this scale
 * (80 laps in JSON ≈ 850 bytes; binary ≈ 350 bytes — both well under any
 * reasonable QR capacity at high error correction). JSON is debuggable
 * and keeps the codepath simple. If the lap counts ever balloon (unlikely
 * for this domain), revisit.
 */

export const PAYLOAD_VERSION = 1;

export interface TransferPayload {
  version: number;
  activityId: string;
  scoreKey: string;
  laps: Array<{ number: number; elapsedMs: number }>;
}

interface CompactPayload {
  v: number;
  a: string;
  s: string;
  l: Array<[number, number]>;
}

export function encodePayload(p: TransferPayload): string {
  const compact: CompactPayload = {
    v: p.version,
    a: p.activityId,
    s: p.scoreKey,
    l: p.laps.map((lap) => [lap.number, lap.elapsedMs]),
  };
  return JSON.stringify(compact);
}

export function decodePayload(raw: string): TransferPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isObject(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  const v = obj.v;
  if (typeof v !== "number" || v !== PAYLOAD_VERSION) return null;

  const a = obj.a;
  if (typeof a !== "string" || a.length === 0) return null;

  const s = obj.s;
  if (typeof s !== "string" || s.length === 0) return null;

  if (!Array.isArray(obj.l)) return null;

  const laps: Array<{ number: number; elapsedMs: number }> = [];
  for (const item of obj.l) {
    if (!Array.isArray(item) || item.length !== 2) return null;
    const [num, ms] = item as [unknown, unknown];
    if (typeof num !== "number" || !Number.isInteger(num) || num < 1) return null;
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
    laps.push({ number: num, elapsedMs: ms });
  }

  return {
    version: v,
    activityId: a,
    scoreKey: s,
    laps,
  };
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
