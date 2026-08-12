import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SessionActions, SessionStatusBadge } from "@/components/session-actions";
import { WorkoutPush } from "@/components/workout-push";
import { getPlanSessions, getSession, getWorkoutConflict, type Step } from "@/lib/queries";
import { SESSION_META, dayLabel, duration, km, paceTarget } from "@/lib/format";

export const dynamic = "force-dynamic";

const STEP_LABEL: Record<string, string> = {
  warmup: "Warming-up",
  cooldown: "Cooling-down",
  work: "Lopen",
  run: "Lopen",
  walk: "Wandelen",
  recover: "Herstel",
  rest: "Rust",
};

const STEP_COLOR: Record<string, string> = {
  warmup: "bg-sleep",
  cooldown: "bg-sleep",
  work: "bg-strain",
  run: "bg-strain",
  walk: "bg-s3",
  recover: "bg-s3",
  rest: "bg-s3",
};

/** Opeenvolgende stappen met dezelfde herhaling horen bij elkaar: dat is één
 *  intervalblok, geen losse stappen. */
function group(steps: Step[]): { repeat: number; steps: Step[] }[] {
  const out: { repeat: number; steps: Step[] }[] = [];
  for (const step of steps) {
    const last = out.at(-1);
    if (last && last.repeat === step.repeat && step.repeat > 1) {
      last.steps.push(step);
    } else {
      out.push({ repeat: step.repeat, steps: [step] });
    }
  }
  return out;
}

function stepAmount(s: Step): string {
  if (s.duration_s) return `${Math.round(s.duration_s / 60)} min`;
  if (s.distance_m) return `${s.distance_m} m`;
  return "";
}

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sessionId = Number(id);
  const [session, workoutConflict] = await Promise.all([
    getSession(sessionId),
    getWorkoutConflict(sessionId),
  ]);
  if (!session) notFound();
  const planSessions = await getPlanSessions(session.plan_id);

  const meta = SESSION_META[session.session_type];
  const steps = session.structure?.steps ?? [];
  const blocks = group(steps);

  // Het tempodoel van het werkdeel is wat je onthoudt van een kwaliteitssessie.
  const workPace =
    paceTarget(
      steps.find(
        (s) => ["work", "run"].includes(s.type) && paceTarget(s) !== null,
      ) ?? {},
    ) ?? null;

  return (
    <main className="space-y-5">
      <header>
        <div className="flex items-center justify-between gap-3">
          <Button asChild variant="icon" size="icon">
            <Link href="/plan" aria-label="Terug naar je plan">
              <ArrowLeft />
            </Link>
          </Button>
          <Badge className={`mt-1 ${meta.badge}`}>
            <span className={`size-1.5 rounded-full ${meta.dot}`} />
            {meta.label}
          </Badge>
        </div>

        <div className="mt-4">
          <div className="flex items-center gap-2">
            <div className="label">{dayLabel(session.day)}</div>
            {session.status !== "planned" ? <SessionStatusBadge status={session.status} /> : null}
          </div>
          <h1 className="mt-1.5 max-w-md text-[28px] font-bold leading-[1.08] tracking-[-0.035em] text-ink">
            {session.title}
          </h1>
        </div>

        {session.description ? (
          <div className="relative mt-4 pl-4">
            <span
              className={`absolute inset-y-0 left-0 w-[3px] rounded-full ${meta.dot}`}
              aria-hidden
            />
            <div className={`text-[9px] font-bold uppercase tracking-[0.09em] ${meta.color}`}>
              Coachbriefing
            </div>
            <p className="mt-1.5 max-w-md text-[13px] leading-[1.65] text-muted">
              {session.description}
            </p>
          </div>
        ) : null}
      </header>

      <div className="flex gap-2">
        <StatCard label="Duur" value={duration(session.planned_duration_s)} />
        <StatCard label="Afstand" value={km(session.planned_distance_m)} />
        {/* Toon waarop hij stuurt, niet allebei: bij een easy run is dat de
            hartslag, bij intervallen het tempo. Vier kaarten naast elkaar leest
            op een telefoon toch niet. */}
        {workPace ? (
          <StatCard label="Tempo" value={`${workPace}`} unit="/km" tone="text-ink" />
        ) : session.hr_cap ? (
          <StatCard label="HR-plafond" value={String(session.hr_cap)} tone="text-teal" />
        ) : null}
      </div>

      <SessionActions session={session} planSessions={planSessions} />

      {blocks.length > 0 && (
        <section>
          <div className="label mb-2.5">Structuur</div>
          <div className="flex flex-col gap-1.5">
            {blocks.map((block, i) =>
              block.repeat > 1 ? (
                <Card
                  key={i}
                  className="p-[11px_13px]"
                >
                  <div className="flex items-center gap-3">
                    <span className={`h-[26px] w-[3px] shrink-0 rounded-full ${meta.dot}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold">
                        {block.repeat} × herhalen
                      </div>
                      <div className="mt-px text-[11px] text-faint">
                        {Math.round(
                          (block.steps.reduce((n, s) => n + s.duration_s, 0) *
                            block.repeat) /
                            60,
                        )}{" "}
                        minuten totaal
                      </div>
                    </div>
                  </div>
                  <div className="mt-2.5 flex flex-col gap-[5px] pl-[15px]">
                    {block.steps.map((s, j) => (
                      <div
                        key={j}
                        className="flex items-center gap-2.5 rounded-lg bg-canvas/55 px-[11px] py-2"
                      >
                        <span className="numeral w-3 text-[11px] font-semibold text-faint">
                          {j + 1}
                        </span>
                        <span className="flex-1 text-xs font-medium">
                          {STEP_LABEL[s.type] ?? s.type}
                        </span>
                        <span className="numeral text-xs text-muted">{stepAmount(s)}</span>
                        {paceTarget(s) ? (
                          <span className="numeral text-[11px] font-semibold text-ink">
                            {paceTarget(s)}
                            <span className="ml-0.5 font-normal text-faint">/km</span>
                          </span>
                        ) : null}
                        {s.hr_max > 0 && (
                          <span
                            className={`numeral text-[11px] font-semibold ${
                              s.type === "walk" || s.type === "recover"
                                ? "text-faint"
                                : "text-teal"
                            }`}
                          >
                            ≤{s.hr_max}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              ) : (
                block.steps.map((s, j) => (
                  <Card
                    key={`${i}-${j}`}
                    className="flex items-center gap-3 p-[11px_13px]"
                  >
                    <span
                      className={`h-[26px] w-[3px] shrink-0 rounded-full ${
                        s.type === "work" || s.type === "run"
                          ? meta.dot
                          : STEP_COLOR[s.type] ?? meta.dot
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium">
                        {STEP_LABEL[s.type] ?? s.type}
                      </div>
                      {s.note && (
                        <div className="mt-px text-[11px] text-faint">{s.note}</div>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="numeral text-[13px] font-semibold">
                        {stepAmount(s)}
                      </div>
                      <div className="numeral text-[10px] text-faint">
                        {[paceTarget(s) ? `${paceTarget(s)}/km` : null,
                          s.hr_max > 0 ? `≤ ${s.hr_max}` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                  </Card>
                ))
              ),
            )}
          </div>
        </section>
      )}

      {session.hr_cap && (
        <Card className="border-line-strong p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[9px] font-bold uppercase tracking-[0.09em] text-teal">
              Kernregel
            </div>
            <Badge variant="teal" className="h-5 shrink-0 px-2">
              HR ≤ {session.hr_cap}
            </Badge>
          </div>
          <h2 className="mt-2 text-[14px] font-semibold tracking-[-0.02em] text-ink">
            Waarom je hartslag begrensd is
          </h2>
          <p className="mt-2 text-[12px] leading-[1.65] text-muted">
            Elke rustige sessie krijgt verplicht een HR-bovengrens. Jouw grijze-zone-patroon
            begon precies hier: 67,5% van je trainingstijd zat in zone 4.
          </p>
        </Card>
      )}

      <WorkoutPush session={session} conflict={workoutConflict} />
    </main>
  );
}

function StatCard({
  label,
  value,
  unit,
  tone = "text-ink",
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: string;
}) {
  return (
    <Card className="flex-1 px-3.5 py-3">
      <div className="text-[10px] font-medium text-faint">{label}</div>
      <div className={`numeral mt-1.5 text-[22px] font-bold ${tone}`}>
        {value}
        {unit ? <span className="ml-0.5 text-[11px] font-normal text-faint">{unit}</span> : null}
      </div>
    </Card>
  );
}
