"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { BottomNav } from "@/components/nav";

/** Een vaste iOS-viewport met daarbinnen precies één scroller. Daardoor blijft
 * de bottom navigation buiten Safari's document-scroll en dus echt onderaan. */
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
    <div className="app-viewport fixed inset-0 overflow-hidden">
      <div ref={scroller} className="app-scroll h-full overflow-x-hidden overflow-y-auto">
        {children}
      </div>
      <BottomNav />
    </div>
  );
}
