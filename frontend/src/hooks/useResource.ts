"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export type DemoState = "loading" | "empty" | "error" | null;

/** `?demo=loading|empty|error` forces a state so reviewers can see every template. */
export function useDemoState(): DemoState {
  const value = useSearchParams().get("demo");
  return value === "loading" || value === "empty" || value === "error" ? value : null;
}

interface ResourceState<T> {
  data: T | undefined;
  error: Error | null;
  isLoading: boolean;
  reload: () => void;
}

interface Settled<T> {
  key: string;
  data: T | undefined;
  error: Error | null;
}

/**
 * Loads data for a client page. Results are keyed by request, so a reload keeps
 * showing the previous data instead of flashing the skeleton.
 */
export function useResource<T>(load: () => Promise<T>, deps: readonly unknown[] = []): ResourceState<T> {
  const demo = useDemoState();
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([demo, attempt, ...deps]);
  const [settled, setSettled] = useState<Settled<T>>({ key: "", data: undefined, error: null });

  useEffect(() => {
    let active = true;
    if (demo === "loading") return;
    if (demo === "error") {
      const timer = setTimeout(() => active && setSettled({ key, data: undefined, error: new Error("demo") }), 200);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }
    load()
      .then((data) => active && setSettled({ key, data, error: null }))
      .catch((err: unknown) => active && setSettled({ key, data: undefined, error: err instanceof Error ? err : new Error(String(err)) }));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures demo, attempt and caller deps.
  }, [key]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const pending = settled.key !== key;
  const isLoading = demo === "loading" || (pending && (settled.data === undefined || settled.error !== null));
  return {
    data: demo === "loading" ? undefined : settled.data,
    error: pending ? null : settled.error,
    isLoading,
    reload,
  };
}
