"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Bot, CalendarDays, CircleUserRound, Gauge } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Vandaag", icon: Gauge },
  { href: "/plan", label: "Plan", icon: CalendarDays },
  { href: "/activiteiten", label: "Activiteiten", icon: Activity },
  { href: "/profiel", label: "Profiel", icon: CircleUserRound },
];

const COACH_TAB = { href: "/coach", label: "Coach", icon: Bot };

/** Vier bestemmingen in een zwevende capsule, met Coach als aparte ronde
 *  actieknop. De compositie volgt de aangeleverde mobiele referentie zonder
 *  het WHOOP-logo na te bootsen. */
export function BottomNav() {
  const path = usePathname();
  const coachActive = path.startsWith(COACH_TAB.href);
  const CoachIcon = COACH_TAB.icon;

  return (
    <nav
      aria-label="Hoofdnavigatie"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-3 safe-bottom"
    >
      <div className="pointer-events-auto mx-auto flex max-w-[500px] items-end gap-2">
        <div className="nav-glass grid h-[64px] min-w-0 flex-1 grid-cols-4 overflow-hidden rounded-[24px] border p-1">
          {TABS.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? path === "/" : path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-ring group relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-[19px] transition-colors",
                  active ? "text-ink" : "text-faint hover:bg-s2/70 hover:text-muted",
                )}
              >
                {active ? (
                  <span
                    className="absolute inset-x-3 bottom-0 h-7 rounded-full bg-ink/10 blur-xl"
                    aria-hidden
                  />
                ) : null}
                <span className="relative z-10 grid size-7 place-items-center">
                  <Icon className="size-[19px]" strokeWidth={active ? 2.15 : 1.65} />
                </span>
                <span className="relative z-10 truncate text-[9px] font-semibold">
                  {label}
                </span>
              </Link>
            );
          })}
        </div>

        <Link
          href={COACH_TAB.href}
          aria-label={COACH_TAB.label}
          aria-current={coachActive ? "page" : undefined}
          className={cn(
            "nav-glass focus-ring grid size-[64px] shrink-0 place-items-center rounded-full border transition-colors",
            coachActive
              ? "border-teal/40 text-teal"
              : "border-recovery/30 text-recovery hover:border-recovery/50 hover:text-ink",
          )}
        >
          <span
            className={cn(
              "grid size-11 place-items-center rounded-full border bg-canvas/60 transition-colors",
              coachActive ? "border-teal/35 bg-teal/10" : "border-line-strong",
            )}
          >
            <CoachIcon className="size-5" strokeWidth={coachActive ? 2.15 : 1.75} />
          </span>
        </Link>
      </div>
    </nav>
  );
}
