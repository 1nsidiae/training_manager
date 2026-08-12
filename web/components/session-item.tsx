import type { Adjustment, PlanSession } from "@/lib/queries";
import { SESSION_META, duration, km, shortDay } from "@/lib/format";

const SEVERITY = {
  override: "border-danger/40 text-danger",
  limit: "border-warning/40 text-warning",
  info: "border-line text-muted",
} as const;

/** Metric List Row met progressive disclosure. De uitleg van de guardrails
 *  hoort bij de sessie waar hij over gaat, niet in een logboek onderaan. */
export function SessionItem({
  session,
  adjustments = [],
}: {
  session: PlanSession;
  adjustments?: Adjustment[];
}) {
  const meta = SESSION_META[session.session_type];
  const steps = session.structure?.steps ?? [];
  const isToday = session.day === new Date().toISOString().slice(0, 10);

  return (
    <details id={`s${session.id}`} className="group row overflow-hidden">
      <summary
        className={`flex min-h-[52px] cursor-pointer list-none items-center gap-3 p-2.5 ${
          isToday ? "ring-1 ring-inset ring-line-strong" : ""
        }`}
      >
        <div className="grid w-9 shrink-0 place-items-center rounded-[8px] bg-canvas/60 py-1">
          <span className="micro uppercase">{shortDay(session.day)}</span>
          <span className="numeral text-sm font-bold">{session.day.slice(8)}</span>
        </div>

        <span className={`h-8 w-[3px] shrink-0 rounded-full ${meta.dot}`} />

        <div className="min-w-0 flex-1">
          <div className={`text-[0.625rem] font-medium ${meta.color}`}>{meta.label}</div>
          <div className="truncate text-sm font-medium">{session.title}</div>
        </div>

        <div className="shrink-0 text-right">
          <div className="numeral text-sm font-semibold">
            {km(session.planned_distance_m)}
          </div>
          {session.hr_cap ? (
            <div className="micro text-teal">≤ {session.hr_cap}</div>
          ) : session.planned_duration_s ? (
            <div className="micro">{duration(session.planned_duration_s)}</div>
          ) : null}
        </div>

        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="size-4 shrink-0 text-faint transition-transform group-open:rotate-90"
        >
          <path
            d="m9 5 7 7-7 7"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>

      <div className="space-y-3 border-t border-line px-2.5 py-3">
        {session.description && (
          <p className="text-sm leading-relaxed text-muted">{session.description}</p>
        )}

        {steps.length > 0 && (
          <ol className="space-y-1">
            {steps.map((s, i) => (
              <li
                key={i}
                className="flex items-center gap-3 rounded-[8px] bg-canvas/50 px-2.5 py-2 text-xs"
              >
                <span className="numeral w-4 text-faint">{i + 1}</span>
                <span className="flex-1 capitalize">
                  {s.repeat > 1 && (
                    <span className="numeral mr-1 font-semibold">{s.repeat}×</span>
                  )}
                  {s.type}
                  {s.note && <span className="ml-1 text-faint">— {s.note}</span>}
                </span>
                <span className="numeral shrink-0 text-muted">
                  {s.duration_s ? `${Math.round(s.duration_s / 60)} min` : ""}
                  {s.distance_m ? `${s.distance_m} m` : ""}
                </span>
                {s.hr_max > 0 && (
                  <span className="numeral micro shrink-0">≤{s.hr_max}</span>
                )}
              </li>
            ))}
          </ol>
        )}

        {adjustments.length > 0 && (
          <div className="space-y-2 border-t border-line pt-3">
            {adjustments.map((a) => (
              <div key={a.id}>
                <span
                  className={`inline-block rounded-full border px-2 py-0.5 text-[0.625rem] ${
                    SEVERITY[a.severity] ?? SEVERITY.info
                  }`}
                >
                  {a.rule}
                </span>
                <p className="mt-1.5 text-xs leading-relaxed text-muted">
                  {a.explanation.nl}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
