import Link from "next/link";
import { AlertCircle, CalendarClock, Check, SkipForward } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { PlanSession } from "@/lib/queries";
import { SESSION_META, duration, km, paceTarget, shortDay } from "@/lib/format";

/** Rij in de weekplanning. Alleen een expliciet gekoppelde/voltooide sessie
 *  telt als gedaan; een datum in het verleden is geen bewijs van uitvoering. */
export function PlanSessionRow({ session }: { session: PlanSession }) {
  const meta = SESSION_META[session.session_type];
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const isToday = session.day === today;
  const done = session.status === "completed";
  const skipped = session.status === "skipped";
  const moved = session.status === "moved";
  const unregistered = session.status === "planned" && session.day < today;

  // Eén getal per rij: het doel waarop deze sessie stuurt. Bij kwaliteitswerk is
  // dat het tempo, bij een rustige duurloop het hartslagplafond.
  const pace = paceTarget(
    (session.structure?.steps ?? []).find(
      (s) => ["work", "run"].includes(s.type) && paceTarget(s) !== null,
    ) ?? {},
  );

  return (
    <Link
      href={`/plan/${session.id}`}
      id={`s${session.id}`}
      className={`focus-ring surface-pressable flex min-h-[60px] items-center gap-[11px] rounded-xl border border-transparent bg-s2 p-[9px_10px] ${
        isToday ? "border-line-strong" : ""
      }`}
    >
      <div className="flex w-9 shrink-0 flex-col items-center gap-px rounded-lg bg-canvas/60 py-1">
        <span className="text-[9px] font-medium uppercase text-faint">
          {shortDay(session.day)}
        </span>
        <span className="numeral text-[13px] font-bold">{session.day.slice(8)}</span>
      </div>

      <span
        className={`h-[30px] w-[3px] shrink-0 rounded-full ${meta.dot}`}
        aria-hidden
      />

      <div className={`min-w-0 flex-1 ${done || skipped ? "opacity-55" : ""}`}>
        <div className={`text-[10px] font-medium ${meta.color}`}>{meta.label}</div>
        <div className="truncate text-[13px] font-medium">{session.title}</div>
      </div>

      <div className={`shrink-0 text-right ${done || skipped ? "opacity-55" : ""}`}>
        <div className="numeral text-[13px] font-semibold">
          {session.planned_distance_m
            ? km(session.planned_distance_m)
            : duration(session.planned_duration_s)}
        </div>
        {done ? (
          <Badge variant="teal" className="mt-1 h-5 px-1.5"><Check className="size-2.5" /> gedaan</Badge>
        ) : skipped ? (
          <Badge variant="warning" className="mt-1 h-5 px-1.5"><SkipForward className="size-2.5" /> overgeslagen</Badge>
        ) : moved ? (
          <Badge variant="recovery" className="mt-1 h-5 px-1.5"><CalendarClock className="size-2.5" /> verplaatst</Badge>
        ) : unregistered ? (
          <Badge variant="outline" className="mt-1 h-5 px-1.5"><AlertCircle className="size-2.5" /> niet geregistreerd</Badge>
        ) : pace ? (
          <div className="numeral text-[10px] font-bold text-ink">{pace}/km</div>
        ) : session.hr_cap ? (
          <div className="text-[10px] font-bold text-teal">≤ {session.hr_cap}</div>
        ) : null}
      </div>
    </Link>
  );
}

/** Ingeklapte week: alleen het ritme, geen sessiedetails. */
export function WeekBlocks({ sessions }: { sessions: PlanSession[] }) {
  const byDay = new Map(sessions.map((s) => [new Date(`${s.day}T12:00:00`).getDay(), s]));
  const order = [1, 2, 3, 4, 5, 6, 0];

  return (
    <div className="flex gap-1">
      {order.map((d) => {
        const session = byDay.get(d);
        const meta = session ? SESSION_META[session.session_type] : null;
        return (
          <div
            key={d}
            className={`h-[26px] flex-1 rounded-md ${meta ? meta.dot : "bg-s3 opacity-50"}`}
          />
        );
      })}
    </div>
  );
}
