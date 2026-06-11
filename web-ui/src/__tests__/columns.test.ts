import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { clampWidth, useColumnWidths, type ColBounds, type ColWidths } from "../lib/columns";

const BOUNDS: ColBounds = { job: { min: 180, max: 760 }, target: { min: 90, max: 420 } };
const DEFAULTS: ColWidths = { job: 360, target: 150 };
const KEY = "test.col-widths";

describe("clampWidth", () => {
  it("clamps below min and above max, and rounds", () => {
    expect(clampWidth(BOUNDS, "job", 50)).toBe(180);
    expect(clampWidth(BOUNDS, "job", 9999)).toBe(760);
    expect(clampWidth(BOUNDS, "job", 360.6)).toBe(361);
  });
  it("falls back to permissive bounds for unknown columns", () => {
    expect(clampWidth(BOUNDS, "mystery", 10)).toBe(60);
    expect(clampWidth(BOUNDS, "mystery", 5000)).toBe(1200);
  });
});

// jsdom in this setup ships a non-functional localStorage stub — install a
// working in-memory one so persistence can actually be exercised.
function installLocalStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
}

describe("useColumnWidths", () => {
  beforeEach(installLocalStorage);

  it("starts from defaults when nothing is persisted", () => {
    const { result } = renderHook(() => useColumnWidths(KEY, DEFAULTS, BOUNDS));
    expect(result.current.widths).toEqual(DEFAULTS);
  });

  it("loads persisted widths and clamps out-of-range saved values", () => {
    localStorage.setItem(KEY, JSON.stringify({ job: 9999, target: 200 }));
    const { result } = renderHook(() => useColumnWidths(KEY, DEFAULTS, BOUNDS));
    expect(result.current.widths.job).toBe(760);   // clamped to max
    expect(result.current.widths.target).toBe(200); // in range, kept
  });

  it("set() clamps and persists to localStorage", () => {
    const { result } = renderHook(() => useColumnWidths(KEY, DEFAULTS, BOUNDS));
    act(() => result.current.set("job", 10_000));
    expect(result.current.widths.job).toBe(760);
    expect(JSON.parse(localStorage.getItem(KEY)!).job).toBe(760);
  });

  it("ignores unknown columns and survives corrupt storage", () => {
    localStorage.setItem(KEY, "{not json");
    const { result } = renderHook(() => useColumnWidths(KEY, DEFAULTS, BOUNDS));
    expect(result.current.widths).toEqual(DEFAULTS);
    act(() => result.current.set("ghost", 300));
    expect(result.current.widths).toEqual(DEFAULTS); // no 'ghost' key added
  });
});
