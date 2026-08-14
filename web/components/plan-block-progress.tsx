import { SESSION_META } from "@/lib/format";
import type { PlanSession } from "@/lib/queries";
import { cn } from "@/lib/utils";

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function localToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatEndDate(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("nl-BE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function PlanBlockProgress({
  weeks,
  currentIndex,
}: {
  weeks: Array<[string, PlanSession[]]>;
  currentIndex: number;
}) {
  const today = localToday();
  const sessions = weeks.flatMap(([, list]) => list);
  const completedSessions = sessions.filter((session) => session.status === "completed").length;
  const finishedWeeks = weeks.filter(([weekStart]) => addDays(weekStart, 6) < today).length;
  const lastWeek = weeks.at(-1)?.[0];
  const endDate = lastWeek ? formatEndDate(addDays(lastWeek, 6)) : null;

  return (
    <div className="mt-4 border-t border-line pt-3.5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="label">Blokvoortgang</div>
          <div className="mt-1 text-[11px] text-muted">
            <span className="numeral font-semibold text-ink">{completedSessions}</span> van {sessions.length} sessies afgerond
          </div>
        </div>
        {endDate ? (
          <div className="text-right">
            <div className="micro">Einddatum</div>
            <time className="mt-1 block text-[10px] font-semibold capitalize text-muted">{endDate}</time>
          </div>
        ) : null}
      </div>

      <div
        className="mt-3 grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${Math.max(weeks.length, 1)}, minmax(0, 1fr))` }}
        aria-label={`${finishedWeeks} van ${weeks.length} weken afgerond`}
      >
        {weeks.map(([weekStart, list], index) => {
          const isFinished = addDays(weekStart, 6) < today;
          const isCurrent = index === currentIndex;
          const primaryType = list.find((session) => session.sport === "running")?.session_type;

          return (
            <span
              key={weekStart}
              className={cn(
                "h-1.5 rounded-full bg-s3",
                isFinished && "bg-teal",
                isCurrent && (primaryType ? SESSION_META[primaryType].dot : "bg-strain"),
              )}
              aria-label={`Week ${index + 1}${isFinished ? ": afgerond" : isCurrent ? ": huidige week" : ": gepland"}`}
              title={`Week ${index + 1}`}
            />
          );
        })}
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <div className="micro">Weken afgerond</div>
          <div className="numeral mt-1 text-[24px] font-bold text-ink">
            {finishedWeeks}<span className="text-[14px] text-faint">/{weeks.length}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="micro">Nu</div>
          <div className="mt-1 text-[11px] font-semibold text-ink">Week {Math.min(currentIndex + 1, weeks.length)}</div>
        </div>
      </div>
    </div>
  );
}
