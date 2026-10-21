"use client";

import { useEffect, useState } from "react";

/** Current time, captured once per mount and optionally ticking, so render stays pure. */
export function useNow(tickMs?: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!tickMs) return;
    const timer = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(timer);
  }, [tickMs]);
  return now;
}
