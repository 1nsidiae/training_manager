"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { BottomNav } from "@/components/nav";

/** Eén documentvaste app-grid: de inhoud scrollt, de navigatie neemt zijn eigen
 * rij in. Er worden bewust geen iOS-viewportwaarden in JavaScript gemeten. */
export function AppViewport({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const scroller = React.useRef<HTMLDivElement>(null);
  const previousPath = React.useRef(pathname);

  React.useEffect(() => {
    if (previousPath.current !== pathname) {
      scroller.current?.scrollTo({ top: 0, behavior: "instant" });
      previousPath.current = pathname;
    }
  }, [pathname]);

  return (
    <div className="app-viewport">
      <div ref={scroller} className="app-scroll overflow-x-hidden overflow-y-auto">
        {children}
      </div>
      <BottomNav />
    </div>
  );
}
