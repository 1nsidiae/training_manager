import type { PlanSession } from "@/lib/queries";
import { SESSION_META } from "@/lib/format";

const DAYS = ["M", "D", "W", "D", "V", "Z", "Z"];

/** Weekritme in één oogopslag. Rustdagen zijn expliciet zichtbaar — dat is de
 *  helft van een schema. */
export function WeekStrip({
  weekStart,
  sessions,
}: {
  weekStart: string;
  sessions: PlanSession[];
}) {
  const byDay = new Map(sessions.map((s) => [s.day, s]));
  const monday = new Date(`${weekStart}T12:00:00`);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex gap-1">
      {DAYS.map((letter, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const iso = d.toISOString().slice(0, 10);
        const session = byDay.get(iso);
        const meta = session ? SESSION_META[session.session_type] : null;
        const isToday = iso === today;

        return (
          <div key={i} className="flex flex-1 flex-col items-center gap-1">
            <span className={`micro ${isToday ? "text-ink" : ""}`}>{letter}</span>
            <div
              className={`h-8 w-full rounded-[6px] ${meta ? meta.dot : "bg-s3"} ${
                isToday ? "ring-1 ring-line-strong ring-offset-2 ring-offset-s1" : ""
              }`}
              style={session ? undefined : { opacity: 0.5 }}
            />
            <span className="numeral micro">
              {session?.planned_distance_m
                ? (session.planned_distance_m / 1000).toFixed(1)
                : "·"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
