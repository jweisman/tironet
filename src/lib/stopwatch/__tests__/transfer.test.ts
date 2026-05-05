import { describe, it, expect } from "vitest";
import {
  PAYLOAD_VERSION,
  decodePayload,
  encodePayload,
  type TransferPayload,
} from "../transfer";

const VALID: TransferPayload = {
  version: PAYLOAD_VERSION,
  activityId: "11111111-2222-3333-4444-555555555555",
  scoreKey: "score1",
  laps: [
    { number: 1, elapsedMs: 5_260 },
    { number: 2, elapsedMs: 12_270 },
    { number: 3, elapsedMs: 35_240 },
  ],
};

describe("encodePayload + decodePayload", () => {
  it("round-trips a valid payload", () => {
    const encoded = encodePayload(VALID);
    const decoded = decodePayload(encoded);
    expect(decoded).toEqual(VALID);
  });

  it("encodes laps as compact [number, ms] pairs (size win at scale)", () => {
    const encoded = encodePayload(VALID);
    expect(encoded).toContain("[1,5260]");
    expect(encoded).toContain("[2,12270]");
  });

  it("round-trips an empty lap list", () => {
    const empty: TransferPayload = { ...VALID, laps: [] };
    expect(decodePayload(encodePayload(empty))).toEqual(empty);
  });

  it("round-trips 80 laps cleanly", () => {
    const laps = Array.from({ length: 80 }, (_, i) => ({
      number: i + 1,
      elapsedMs: (i + 1) * 1_234,
    }));
    const big: TransferPayload = { ...VALID, laps };
    const decoded = decodePayload(encodePayload(big));
    expect(decoded?.laps).toEqual(laps);
  });
});

describe("decodePayload — error cases", () => {
  it("returns null on malformed JSON", () => {
    expect(decodePayload("not json")).toBeNull();
    expect(decodePayload("")).toBeNull();
  });

  it("returns null on a non-object root", () => {
    expect(decodePayload("[]")).toBeNull();
    expect(decodePayload('"hi"')).toBeNull();
    expect(decodePayload("null")).toBeNull();
  });

  it("returns null when version mismatches", () => {
    const tampered = JSON.stringify({ ...buildCompact(VALID), v: 999 });
    expect(decodePayload(tampered)).toBeNull();
  });

  it("returns null when version is missing or non-numeric", () => {
    const noVersion = JSON.stringify({ a: VALID.activityId, s: VALID.scoreKey, l: [] });
    expect(decodePayload(noVersion)).toBeNull();

    const stringVersion = JSON.stringify({
      v: "1",
      a: VALID.activityId,
      s: VALID.scoreKey,
      l: [],
    });
    expect(decodePayload(stringVersion)).toBeNull();
  });

  it("returns null when activityId is missing or empty", () => {
    expect(decodePayload(JSON.stringify({ ...buildCompact(VALID), a: "" }))).toBeNull();
    const noA = JSON.stringify({ v: 1, s: "score1", l: [] });
    expect(decodePayload(noA)).toBeNull();
  });

  it("returns null when scoreKey is missing or empty", () => {
    expect(decodePayload(JSON.stringify({ ...buildCompact(VALID), s: "" }))).toBeNull();
    const noS = JSON.stringify({ v: 1, a: VALID.activityId, l: [] });
    expect(decodePayload(noS)).toBeNull();
  });

  it("returns null when laps array is malformed", () => {
    const badLap = JSON.stringify({ ...buildCompact(VALID), l: [[1]] }); // single-element pair
    expect(decodePayload(badLap)).toBeNull();

    const wrongTypes = JSON.stringify({ ...buildCompact(VALID), l: [["1", "5"]] });
    expect(decodePayload(wrongTypes)).toBeNull();

    const negativeNumber = JSON.stringify({ ...buildCompact(VALID), l: [[-1, 5]] });
    expect(decodePayload(negativeNumber)).toBeNull();

    const negativeMs = JSON.stringify({ ...buildCompact(VALID), l: [[1, -5]] });
    expect(decodePayload(negativeMs)).toBeNull();

    const fractionalNumber = JSON.stringify({ ...buildCompact(VALID), l: [[1.5, 5]] });
    expect(decodePayload(fractionalNumber)).toBeNull();

    const notAnArray = JSON.stringify({ ...buildCompact(VALID), l: "oops" });
    expect(decodePayload(notAnArray)).toBeNull();
  });

  it("returns null when a lap pair entry is non-finite", () => {
    const inf = JSON.stringify({ ...buildCompact(VALID), l: [[1, Number.POSITIVE_INFINITY]] });
    // JSON.stringify drops Infinity to null; deserialize and check that path too.
    expect(decodePayload(inf)).toBeNull();
  });
});

function buildCompact(p: TransferPayload) {
  return {
    v: p.version,
    a: p.activityId,
    s: p.scoreKey,
    l: p.laps.map((lap) => [lap.number, lap.elapsedMs] as [number, number]),
  };
}
