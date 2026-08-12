"use client";

import { useEffect, useRef, useState } from "react";

/** Consistente chevron: elke kaart die detail opent draagt er een. */
export function Chevron({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={`size-4 shrink-0 text-faint ${className}`}
      aria-hidden
    >
      <path
        d="m9 5 7 7-7 7"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Waarden tellen zacht naar hun eindwaarde. Meting, geen speelsheid. */
export function CountUp({
  to,
  duration = 650,
  decimals = 0,
}: {
  to: number | null;
  duration?: number;
  decimals?: number;
}) {
  const [value, setValue] = useState(to ?? 0);
  const raf = useRef<number>(0);

  useEffect(() => {
    if (to == null) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setValue(to);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // ease-out, geen bounce
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(to * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [to, duration]);

  if (to == null) return <>–</>;
  return <>{value.toFixed(decimals)}</>;
}
