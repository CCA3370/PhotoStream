"use client";

import { useEffect, useRef, useState } from "react";

export function AnimatedResultCount({ value }: Readonly<{ value: number }>) {
  const [displayed, setDisplayed] = useState(0);
  const frameRef = useRef<number | null>(null);
  const displayedRef = useRef(0);

  useEffect(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = displayedRef.current;
    if (reduceMotion || start === value) {
      displayedRef.current = value;
      setDisplayed(value);
      frameRef.current = null;
      return;
    }

    const duration = 300;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      const next = Math.round(start + (value - start) * eased);
      displayedRef.current = next;
      setDisplayed(next);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        frameRef.current = null;
      }
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [value]);

  return <span className="tabular-nums">{displayed}</span>;
}
