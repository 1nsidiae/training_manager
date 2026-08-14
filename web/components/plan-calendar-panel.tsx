"use client";

import Link from "next/link";
import * as React from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Ring } from "@/components/ring";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SESSION_META, dayLabel, duration, km } from "@/lib/format";
import type { PlanSession } from "@/lib/queries";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"];
const COLLAPSED_HEIGHT = 176;
const EXPANDED_HEIGHT = 374;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function startOfMonth(iso: string) {
  const date = new Date(`${iso.slice(0, 7)}-01T12:00:00`);
  return date;
}

function monthGrid(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const mondayOffset = (first.getDay() + 6) % 7;
  first.setDate(first.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first);
    date.setDate(first.getDate() + index);
    return date;
  });
}

function CalendarDayDetails({ day, sessions }: { day: string; sessions: PlanSession[] }) {
  return (
    <PopoverContent align="center" sideOffset={7} collisionPadding={12} className="w-[270px] p-3">
      <div className="label mb-2">{dayLabel(day)}</div>
      <div className="space-y-1.5">
        {sessions.map((session) => {
          const meta = SESSION_META[session.session_type];
          return (
            <Link
              key={session.id}
              href={`/plan/${session.id}`}
              className="surface-pressable flex items-center gap-2.5 rounded-row bg-s2 px-2.5 py-2"
            >
              <span className={cn("h-8 w-1 shrink-0 rounded-full", meta.dot)} />
              <span className="min-w-0 flex-1">
                <span className={cn("block text-[10px] font-semibold", meta.color)}>{meta.label}</span>
                <span className="block truncate text-xs font-semibold text-ink">{session.title}</span>
                <span className="micro mt-0.5 block capitalize">{session.status === "completed" ? "Afgerond" : session.status === "moved" ? "Verplaatst" : session.status === "skipped" ? "Overgeslagen" : "Gepland"}</span>
              </span>
              <span className="numeral shrink-0 text-xs text-ink">
                {session.planned_distance_m ? km(session.planned_distance_m) : duration(session.planned_duration_s)}
              </span>
            </Link>
          );
        })}
      </div>
    </PopoverContent>
  );
}

function SessionDots({ sessions }: { sessions: PlanSession[] }) {
  return (
    <span className="flex h-2 items-center justify-center gap-0.5" aria-hidden>
      {sessions.slice(0, 3).map((session) => (
        <span
          key={session.id}
          className={cn(
            "size-1.5 rounded-[2px]",
            SESSION_META[session.session_type].dot,
            session.status === "skipped" && "opacity-25",
            session.status === "moved" && "opacity-45",
          )}
        />
      ))}
    </span>
  );
}

function CalendarDay({
  day,
  sessions,
  today,
  outside = false,
  compact = false,
}: {
  day: string;
  sessions: PlanSession[];
  today: string;
  outside?: boolean;
  compact?: boolean;
}) {
  const content = (
    <span
      className={cn(
        "flex w-full flex-col items-center justify-center rounded-xl text-muted",
        compact ? "min-h-[50px] gap-1" : "min-h-9 gap-0.5",
        outside && "opacity-25",
      )}
    >
      <span
        className={cn(
          "numeral grid size-7 place-items-center rounded-full text-[12px] font-semibold",
          day === today && "bg-ink text-canvas",
        )}
      >
        {Number(day.slice(8))}
      </span>
      <SessionDots sessions={sessions} />
    </span>
  );

  if (sessions.length === 0) return <div aria-label={`${dayLabel(day)}: rustdag`}>{content}</div>;

  const labels = sessions.map((session) => SESSION_META[session.session_type].label).join(" en ");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="focus-ring w-full" aria-label={`${dayLabel(day)}: ${labels}`}>
          {content}
        </button>
      </PopoverTrigger>
      <CalendarDayDetails day={day} sessions={sessions} />
    </Popover>
  );
}

export function PlanCalendarPanel({
  weeks,
  currentIndex,
}: {
  weeks: Array<[string, PlanSession[]]>;
  currentIndex: number;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [panelHeight, setPanelHeight] = React.useState(COLLAPSED_HEIGHT);
  const [dragging, setDragging] = React.useState(false);
  const currentWeekStart = weeks[currentIndex]?.[0] ?? weeks[0]?.[0];
  const [visibleMonth, setVisibleMonth] = React.useState(() => startOfMonth(currentWeekStart ?? isoDate(new Date())));
  const dragStart = React.useRef<{ y: number; height: number } | null>(null);
  const today = isoDate(new Date());
  const sessions = React.useMemo(() => weeks.flatMap(([, list]) => list), [weeks]);
  const sessionsByDay = React.useMemo(() => {
    const map = new Map<string, PlanSession[]>();
    for (const session of sessions) map.set(session.day, [...(map.get(session.day) ?? []), session]);
    return map;
  }, [sessions]);
  const monthDays = monthGrid(visibleMonth);
  const monthLabel = visibleMonth.toLocaleDateString("nl-BE", { month: "long", year: "numeric" });
  const weekProgress = weeks.length ? Math.min(currentIndex + 1, weeks.length) : 0;
  const expansionProgress = clamp(
    (panelHeight - COLLAPSED_HEIGHT) / (EXPANDED_HEIGHT - COLLAPSED_HEIGHT),
    0,
    1,
  );

  React.useEffect(() => {
    function move(event: PointerEvent) {
      if (!dragStart.current) return;
      setDragging(true);
      setPanelHeight(clamp(
        dragStart.current.height + event.clientY - dragStart.current.y,
        COLLAPSED_HEIGHT,
        EXPANDED_HEIGHT,
      ));
    }

    function end(event: PointerEvent) {
      if (!dragStart.current) return;
      const distance = event.clientY - dragStart.current.y;
      const releasedHeight = clamp(
        dragStart.current.height + distance,
        COLLAPSED_HEIGHT,
        EXPANDED_HEIGHT,
      );
      dragStart.current = null;
      const nextExpanded = Math.abs(distance) < 8
        ? !expanded
        : distance > 34
          ? true
          : distance < -34
            ? false
            : releasedHeight > (COLLAPSED_HEIGHT + EXPANDED_HEIGHT) / 2;
      setDragging(false);
      setExpanded(nextExpanded);
      setPanelHeight(nextExpanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT);
    }

    function cancel() {
      dragStart.current = null;
      setDragging(false);
      setPanelHeight(expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT);
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [expanded]);

  function toggleExpanded() {
    const next = !expanded;
    setDragging(false);
    setExpanded(next);
    setPanelHeight(next ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT);
  }

  function shiftMonth(amount: number) {
    setVisibleMonth((month) => new Date(month.getFullYear(), month.getMonth() + amount, 1, 12));
  }

  if (!currentWeekStart || weeks.length === 0) return null;

  return (
    <section
      id="plan-calendar"
      className={cn(
        "relative overflow-hidden rounded-card border border-line bg-s1",
        !dragging && "transition-[height] duration-300 ease-[cubic-bezier(.22,1,.36,1)]",
      )}
      style={{ height: panelHeight }}
      aria-label="Trainingskalender"
    >
      <button
        type="button"
        className="focus-ring flex h-14 w-full items-center gap-3 px-4 text-left"
        onClick={toggleExpanded}
        aria-expanded={expanded}
      >
        <Ring value={weekProgress} max={weeks.length} color="var(--color-teal)" size={34} stroke={4} />
        <span className="min-w-0 flex-1">
          <span className="label block">Planning</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[15px] font-semibold text-ink">
            Week {weekProgress}/{weeks.length}
            <ChevronDown
              className="size-3.5 text-faint"
              style={{ transform: `rotate(${expansionProgress * 180}deg)` }}
            />
          </span>
        </span>
        <CalendarDays className="size-5 text-faint" />
      </button>

      <div className="absolute inset-x-0 bottom-5 top-14 overflow-hidden border-t border-line">
        <div
          className={cn(
            "absolute inset-0 grid grid-cols-7 px-2 pb-2 pt-1.5",
            expansionProgress > 0.68 && "pointer-events-none",
          )}
          style={{
            opacity: clamp(1 - expansionProgress * 1.7, 0, 1),
            visibility: expansionProgress > 0.68 ? "hidden" : "visible",
          }}
          aria-hidden={expansionProgress > 0.68}
        >
          {WEEKDAYS.map((label, index) => {
            const day = addDays(currentWeekStart, index);
            return (
              <div key={day} className="text-center">
                <span className="micro block uppercase">{label}</span>
                <CalendarDay day={day} sessions={sessionsByDay.get(day) ?? []} today={today} compact />
              </div>
            );
          })}
        </div>

        <div
          className={cn(
            "absolute inset-0 px-2 pb-2 pt-1.5",
            expansionProgress < 0.12 && "pointer-events-none",
          )}
          style={{
            opacity: clamp((expansionProgress - 0.16) * 1.55, 0, 1),
            visibility: expansionProgress < 0.12 ? "hidden" : "visible",
          }}
          aria-hidden={expansionProgress < 0.12}
        >
          <div className="flex h-9 items-center justify-between px-1.5">
            <Button variant="ghost" size="icon" className="size-8 min-h-8 rounded-full" onClick={() => shiftMonth(-1)} aria-label="Vorige maand">
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-[12px] font-semibold capitalize text-ink">{monthLabel}</span>
            <Button variant="ghost" size="icon" className="size-8 min-h-8 rounded-full" onClick={() => shiftMonth(1)} aria-label="Volgende maand">
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <div className="grid grid-cols-7">
            {WEEKDAYS.map((label) => <span key={label} className="micro py-1 text-center uppercase">{label}</span>)}
            {monthDays.map((date) => {
              const day = isoDate(date);
              return (
                <CalendarDay
                  key={day}
                  day={day}
                  sessions={sessionsByDay.get(day) ?? []}
                  today={today}
                  outside={date.getMonth() !== visibleMonth.getMonth()}
                />
              );
            })}
          </div>
        </div>
      </div>

      <button
        type="button"
        className="focus-ring absolute inset-x-0 bottom-0 flex h-5 w-full touch-none cursor-ns-resize items-center justify-center border-t border-line/70"
        aria-label={expanded ? "Kalender inklappen" : "Kalender volledig tonen"}
        onPointerDown={(event) => {
          dragStart.current = { y: event.clientY, height: panelHeight };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
      >
        <span
          className="h-1 w-10 rounded-full bg-s3 transition-colors"
          style={{ backgroundColor: expansionProgress > 0.08 ? "var(--color-muted)" : undefined }}
        />
      </button>
    </section>
  );
}
