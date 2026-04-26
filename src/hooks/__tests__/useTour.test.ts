import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { VersionedStep } from "@/lib/tour/steps";

// Mock the UserPreferenceContext import so the module can load
vi.mock("@/contexts/UserPreferenceContext", () => ({
  useUserPreferences: () => ({ showTour: true, loaded: true, updatePreference: vi.fn() }),
}));

// Mock driver.js to avoid DOM dependencies
vi.mock("driver.js", () => ({
  driver: vi.fn(() => ({
    drive: vi.fn(),
    destroy: vi.fn(),
  })),
}));

// Mock localStorage for Node.js environment
const store = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (i: number) => [...store.keys()][i] ?? null,
} as Storage;

vi.stubGlobal("localStorage", mockLocalStorage);

import { getSeenVersion, getMaxVersion } from "../useTour";

describe("getSeenVersion", () => {
  beforeEach(() => {
    store.clear();
  });

  afterEach(() => {
    store.clear();
  });

  it("returns 0 when key is absent (never seen)", () => {
    expect(getSeenVersion("home")).toBe(0);
  });

  it("returns 1 for legacy boolean format ('1')", () => {
    store.set("tironet:tour-seen:home", "1");
    expect(getSeenVersion("home")).toBe(1);
  });

  it("returns the stored version number", () => {
    store.set("tironet:tour-seen:soldiers", "3");
    expect(getSeenVersion("soldiers")).toBe(3);
  });

  it("returns 0 for non-numeric values", () => {
    store.set("tironet:tour-seen:activities", "true");
    expect(getSeenVersion("activities")).toBe(0);
  });
});

describe("getMaxVersion", () => {
  it("returns 1 for empty steps array", () => {
    expect(getMaxVersion([])).toBe(1);
  });

  it("returns 1 when all steps have no explicit version", () => {
    const steps: VersionedStep[] = [
      { popover: { title: "a" } },
      { popover: { title: "b" } },
    ];
    expect(getMaxVersion(steps)).toBe(1);
  });

  it("returns the highest version across all steps", () => {
    const steps: VersionedStep[] = [
      { popover: { title: "a" } },
      { popover: { title: "b" }, version: 2 },
      { popover: { title: "c" }, version: 3 },
      { popover: { title: "d" }, version: 2 },
    ];
    expect(getMaxVersion(steps)).toBe(3);
  });

  it("handles mix of versioned and unversioned steps", () => {
    const steps: VersionedStep[] = [
      { popover: { title: "a" } },           // implicit v1
      { popover: { title: "b" }, version: 2 },
    ];
    expect(getMaxVersion(steps)).toBe(2);
  });
});
