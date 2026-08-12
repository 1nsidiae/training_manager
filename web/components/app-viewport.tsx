"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { BottomNav } from "@/components/nav";

/** Een vaste iOS-viewport met daarbinnen precies één scroller. Daardoor blijft
 * de bottom navigation buiten Safari's document-scroll en dus echt onderaan. */
export function AppViewport({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const viewport = React.useRef<HTMLDivElement>(null);
  const scroller = React.useRef<HTMLDivElement>(null);
  const previousPath = React.useRef(pathname);

  React.useEffect(() => {
    const syncVisualViewport = () => {
      const visualViewport = window.visualViewport;
      const visualBottom = visualViewport
        ? visualViewport.height + visualViewport.offsetTop
        : 0;
      const height = Math.max(
        document.documentElement.clientHeight,
        window.innerHeight,
        visualBottom,
      );

      viewport.current?.style.setProperty(
        "--app-viewport-height",
        `${Math.round(height)}px`,
      );
    };

    /* Bij het openen van een standalone PWA klopt de eerste meting niet: iOS
       geeft dan nog een hoogte zonder de onderste safe-area terug en stuurt
       daarna géén resize. Zonder hermeten bleef die verkeerde waarde staan tot
       je het toestel draaide — dat is precies waarom roteren en terugdraaien het
       "repareerde". Daarom meten we een paar keer opnieuw tot het beeld staat. */
    const timers = [0, 120, 400, 1000].map((delay) =>
      window.setTimeout(syncVisualViewport, delay),
    );
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(syncVisualViewport),
    );

    // pageshow vuurt ook wanneer iOS de app uit de achtergrond terughaalt;
    // visibilitychange vangt het terugkeren naar de app zonder herstart.
    const events = ["resize", "orientationchange", "pageshow"] as const;

    syncVisualViewport();
    for (const event of events) window.addEventListener(event, syncVisualViewport);
    document.addEventListener("visibilitychange", syncVisualViewport);
    window.visualViewport?.addEventListener("resize", syncVisualViewport);
    window.visualViewport?.addEventListener("scroll", syncVisualViewport);

    return () => {
      timers.forEach(window.clearTimeout);
      cancelAnimationFrame(frame);
      for (const event of events) window.removeEventListener(event, syncVisualViewport);
      document.removeEventListener("visibilitychange", syncVisualViewport);
      window.visualViewport?.removeEventListener("resize", syncVisualViewport);
      window.visualViewport?.removeEventListener("scroll", syncVisualViewport);
    };
  }, []);

  React.useEffect(() => {
    if (previousPath.current !== pathname) {
      scroller.current?.scrollTo({ top: 0, behavior: "instant" });
      previousPath.current = pathname;
    }
  }, [pathname]);

  return (
    <div
      ref={viewport}
      className="app-viewport fixed inset-x-0 top-0 overflow-hidden"
    >
      <div ref={scroller} className="app-scroll h-full overflow-x-hidden overflow-y-auto">
        {children}
      </div>
      <BottomNav />
    </div>
  );
}
