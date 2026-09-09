"use client";

import { useCallback, useEffect, useState } from "react";

export function useRetryCountdown() {
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(0);
  const wait = useCallback((seconds: number) => {
    const start = Date.now();
    setNow(start);
    setDeadline(start + Math.min(86400, Math.max(0, seconds)) * 1000);
  }, []);
  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= deadline) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [deadline]);
  return { remaining: Math.max(0, Math.ceil((deadline - now) / 1000)), wait };
}
