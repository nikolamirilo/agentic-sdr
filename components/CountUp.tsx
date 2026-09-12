"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Counts up to `target` once scrolled into view. A small, dependency-free
 * stand-in for the "React Bits" style number animation — kept plain (no
 * gradient, no glow) so it fits the single-accent, no-decoration system in
 * globals.css instead of fighting it.
 */
export function CountUp({
  target,
  suffix = "",
  duration = 900,
}: {
  target: number;
  suffix?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduceMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [value, setValue] = useState(reduceMotion ? target : 0);

  useEffect(() => {
    const node = ref.current;
    if (!node || reduceMotion) return;

    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const progress = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - progress, 3);
          setValue(Math.round(target * eased));
          if (progress < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.4 }
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [target, duration, reduceMotion]);

  return (
    <span ref={ref} className="tabular">
      {value}
      {suffix}
    </span>
  );
}
