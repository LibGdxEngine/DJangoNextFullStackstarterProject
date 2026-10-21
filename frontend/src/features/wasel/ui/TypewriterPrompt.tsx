"use client";

import { useEffect, useState } from "react";

const TYPE_SPEED_MS = 35;
const DELETE_SPEED_MS = 18;
const HOLD_MS = 1800;
const GAP_MS = 400;

export function TypewriterPrompt({
  phrases,
  className = "",
}: {
  phrases: string[];
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [length, setLength] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const current = phrases[index % phrases.length];

  useEffect(() => {
    if (!deleting) {
      if (length < current.length) {
        const t = setTimeout(() => setLength((l) => l + 1), TYPE_SPEED_MS);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setDeleting(true), HOLD_MS);
      return () => clearTimeout(t);
    }

    if (length > 0) {
      const t = setTimeout(() => setLength((l) => l - 1), DELETE_SPEED_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setIndex((i) => (i + 1) % phrases.length);
      setDeleting(false);
    }, GAP_MS);
    return () => clearTimeout(t);
  }, [length, deleting, current, phrases.length]);

  return (
    <span className={className}>
      <span aria-hidden="true">{current.slice(0, length)}</span>
      <span aria-hidden="true" className="mr-1 inline-block h-5 w-0.5 align-middle bg-amber animate-pulse" />
      <span className="sr-only">{current}</span>
    </span>
  );
}
