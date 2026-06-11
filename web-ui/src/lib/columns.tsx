/* Resizable table columns — width state with localStorage persistence,
   min/max clamping, content-based auto-fit, and an accessible drag handle.
   Table-agnostic so any grid table can adopt it. */
import React from "react";

export type ColWidths = Record<string, number>;
export type ColBounds = Record<string, { min: number; max: number }>;

/** Clamp a width to a column's bounds (pure — unit-tested). */
export function clampWidth(bounds: ColBounds, key: string, w: number): number {
  const b = bounds[key];
  const lo = b ? b.min : 60;
  const hi = b ? b.max : 1200;
  return Math.max(lo, Math.min(hi, Math.round(w)));
}

/** Persisted, clamped column widths keyed off `storageKey`. `defaults`/`bounds`
    must be stable references (declare them module-level). */
export function useColumnWidths(storageKey: string, defaults: ColWidths, bounds: ColBounds) {
  const [widths, setWidths] = React.useState<ColWidths>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
      const merged: ColWidths = { ...defaults };
      for (const k of Object.keys(defaults)) {
        if (typeof saved[k] === "number") merged[k] = clampWidth(bounds, k, saved[k]);
      }
      return merged;
    } catch {
      return { ...defaults };
    }
  });

  React.useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(widths)); }
    catch { /* quota / serialization — width persistence is non-critical */ }
  }, [storageKey, widths]);

  const set = React.useCallback((key: string, w: number) => {
    setWidths((prev) => (prev[key] === undefined ? prev : { ...prev, [key]: clampWidth(bounds, key, w) }));
  }, [bounds]);

  const reset = React.useCallback((key: string) => {
    setWidths((prev) => ({ ...prev, [key]: defaults[key] }));
  }, [defaults]);

  const clamp = React.useCallback((key: string, w: number) => clampWidth(bounds, key, w), [bounds]);

  return { widths, set, reset, clamp };
}

/** Natural content width of a column: the widest text among its `[data-col=key]`
    cells, even when clipped by ellipsis (scrollWidth reports the un-clipped width). */
export function measureColumn(root: HTMLElement, key: string, buffer = 28): number {
  let max = 0;
  root.querySelectorAll<HTMLElement>(`[data-col="${key}"]`).forEach((cell) => {
    max = Math.max(max, cell.scrollWidth);
    cell.querySelectorAll<HTMLElement>("*").forEach((el) => { max = Math.max(max, el.scrollWidth); });
  });
  return max + buffer;
}

/** Drag handle living at a header cell's right edge. Pointer-drag to resize,
    double-click (or Enter) to auto-fit, Arrow keys to nudge. */
export function ColResizer({ label, width, min, max, onPreview, onCommit, onAutoFit }: {
  label: string;
  width: number;
  min: number;
  max: number;
  onPreview: (w: number) => void;   // live, no re-render (CSS var)
  onCommit: (w: number) => void;    // commit to state + persist
  onAutoFit: () => void;
}) {
  const drag = React.useRef<{ x: number; w: number } | null>(null);

  const down = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: width };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };
  const move = (e: React.PointerEvent) => {
    if (!drag.current) return;
    onPreview(drag.current.w + (e.clientX - drag.current.x));
  };
  const up = (e: React.PointerEvent) => {
    if (!drag.current) return;
    onCommit(drag.current.w + (e.clientX - drag.current.x));
    drag.current = null;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); onCommit(width - 16); }
    else if (e.key === "ArrowRight") { e.preventDefault(); onCommit(width + 16); }
    else if (e.key === "Enter") { e.preventDefault(); onAutoFit(); }
  };

  return (
    <span role="separator" aria-orientation="vertical" aria-label={`Resize ${label} column`}
      aria-valuenow={Math.round(width)} aria-valuemin={min} aria-valuemax={max} tabIndex={0}
      className="col-resizer"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onKeyDown={key} onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); onAutoFit(); }}
      onClick={(e) => e.stopPropagation()}>
      <span className="col-resizer-bar" aria-hidden="true" />
    </span>
  );
}
