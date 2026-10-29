"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "wasel.browserPanelWidth";
export const DEFAULT_PANEL_PCT = 46;
const MIN_PCT = 25;
const MAX_PCT = 75;
const KEY_STEP = 2;

function clamp(pct: number) {
  return Math.min(MAX_PCT, Math.max(MIN_PCT, pct));
}

function readStored(): number {
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? clamp(value) : DEFAULT_PANEL_PCT;
  } catch {
    return DEFAULT_PANEL_PCT;
  }
}

function store(pct: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Math.round(pct)));
  } catch {
    // Private mode or blocked storage: the width just isn't remembered.
  }
}

/**
 * Width of a side panel that sits at the left edge of `containerRef` (the browser panel,
 * after the conversation in a right-to-left row), as a percentage the user drags.
 */
export function useResizablePanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(DEFAULT_PANEL_PCT);
  const [dragging, setDragging] = useState(false);

  // Read the remembered width after mount, so server and client render the same markup.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPct(readStored());
  }, []);

  const widthAt = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || !Number.isFinite(clientX)) return undefined;
    return clamp(((clientX - rect.left) / rect.width) * 100);
  }, []);

  // A ref, not state: a quick drag delivers its moves before React re-renders.
  const draggingRef = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!draggingRef.current) return;
      const next = widthAt(e.clientX);
      if (next !== undefined) setPct(next);
    },
    [widthAt],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      const next = widthAt(e.clientX);
      setDragging(false);
      setPct((current) => {
        const final = next ?? current;
        store(final);
        return final;
      });
    },
    [widthAt],
  );

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    // The panel is on the left, so ArrowRight widens it.
    const delta = e.key === "ArrowRight" ? KEY_STEP : e.key === "ArrowLeft" ? -KEY_STEP : 0;
    if (!delta) return;
    e.preventDefault();
    setPct((current) => {
      const next = clamp(current + delta);
      store(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setPct(DEFAULT_PANEL_PCT);
    store(DEFAULT_PANEL_PCT);
  }, []);

  return {
    containerRef,
    pct,
    dragging,
    handleProps: {
      role: "separator" as const,
      "aria-orientation": "vertical" as const,
      "aria-label": "تغيير عرض المتصفح",
      "aria-valuemin": MIN_PCT,
      "aria-valuemax": MAX_PCT,
      "aria-valuenow": Math.round(pct),
      tabIndex: 0,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onKeyDown,
      onDoubleClick: reset,
    },
  };
}
