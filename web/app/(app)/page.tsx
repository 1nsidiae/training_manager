import Link from "next/link";
import { Activity, ArrowUpRight, CalendarDays, Sparkles, Watch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { BiometricMetricDrawer } from "@/components/biometric-metric-drawer";
import { HealthMetricDrawer } from "@/components/health-metric-drawer";
import { DetailDrawer } from "@/components/detail-drawer";
import { StructureBar } from "@/components/structure-bar";
import { TodayHeader } from "@/components/today-header";
import { PlanApproval } from "@/components/plan-approval";
import { PlanImpactCard } from "@/components/plan-impact-card";
import { PreWorkoutCheckCard } from "@/components/pre-workout-check";
import { TrainingLoadCard } from "@/components/training-load-card";
import { comparePlans } from "@/lib/plan-comparison";
import { buildPreWorkoutCheck } from "@/lib/pre-workout";
import {
  getActivePlan,
  getAdjustments,
  getAthlete,
  getLastGarminSync,
  getVo2MaxWindow,
  getPlanApplySync,
  getPlanActivitySource,
  getPlanSessions,
  getPreviousPlan,
  getProposedPlan,
  getRecentTrainingFeedback,
  getRuleParams,
  getTrainingLoadSummary,
  getWellnessWindow,
} from "@/lib/queries";
import {
  SESSION_META,
  duration,
  hrvTone,
  km,
  paceTarget,
  readinessTone,
  sleepTone,
} from "@/lib/format";

export const dynamic = "force-dynamic";

function statusLine(score: number | null | undefined, hrv: string | null | undefined) {
  if (score == null) return "Geen meting vannacht. Draag je horloge om te slapen.";
  if (score >= 75) return "Je trainingsfitheid is hoog voor de geplande sessie.";
  if (score >= 50)
    return hrv === "UNBALANCED"
      ? "Je trainingsfitheid is gematigd en je HRV-status niet gebalanceerd. Houd de sessie rustig."
      : "Je trainingsfitheid is gematigd. De sessie kan door, forceer niets.";
  if (score >= 25) return "Je trainingsfitheid is laag. Overweeg te verzetten of alleen te wandelen.";
  return "Je trainingsfitheid is slecht. Geef herstel vandaag voorrang.";
}

function mondayOf(d: Date): string {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

function todayInBrussels() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function validSelectedDay(value: string | string[] | undefined, today: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return today;
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return today;
  return value <= today ? value : today;
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string | string[] }>;
}) {
  const today = todayInBrussels();
  const selectedDay = validSelectedDay((await searchParams).day, today);
  const [plan, proposed] = await Promise.all([getActivePlan(), getProposedPlan()]);
  const previousPlan = plan ? await getPreviousPlan(plan) : null;
  const [
    sessions,
    previousSessions,
    proposedSessions,
    wellness,
    vo2,
    rules,
    athlete,
    lastSync,
    proposedAdjustments,
    activeAdjustments,
    trainingLoad,
    impactActivitySource,
    planSync,
    recentFeedback,
  ] =
    await Promise.all([
      plan ? getPlanSessions(plan.id) : Promise.resolve([]),
      previousPlan ? getPlanSessions(previousPlan.id) : Promise.resolve([]),
      proposed ? getPlanSessions(proposed.id) : Promise.resolve([]),
      getWellnessWindow(selectedDay, 180),
      getVo2MaxWindow(selectedDay, 180),
      getRuleParams(),
      getAthlete(),
      getLastGarminSync(),
      proposed ? getAdjustments(proposed.id) : Promise.resolve([]),
      plan ? getAdjustments(plan.id) : Promise.resolve([]),
      getTrainingLoadSummary(selectedDay),
      plan ? getPlanActivitySource(plan) : Promise.resolve(null),
      plan ? getPlanApplySync(plan.id) : Promise.resolve(null),
      getRecentTrainingFeedback(),
    ]);
  const proposedChanges = comparePlans(proposedSessions, sessions);
  const latestPlanChanges = comparePlans(sessions, previousSessions);

  const session =
    sessions.find(
      (item) =>
        item.day >= selectedDay && (item.status === "planned" || item.status === "moved"),
    ) ?? null;
  const latest = wellness.find((item) => item.day === selectedDay) ?? null;
  const series = [...wellness].reverse();
  const vo2maxSeries = vo2.map((item) => ({ day: item.day, value: item.vo2max_running }));
  const readiness = readinessTone(latest?.training_readiness_score);
  const sleep = sleepTone(latest?.sleep_total_s);
  const hrv = hrvTone(latest?.hrv_status);

  const weekStart = mondayOf(new Date(`${selectedDay}T12:00:00`));
  const weekEnd = new Date(`${weekStart}T12:00:00`);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndIso = weekEnd.toISOString().slice(0, 10);

  const weekSessions = sessions.filter((s) => s.day >= weekStart && s.day <= weekEndIso);
  const plannedKm = weekSessions.reduce((n, s) => n + (s.planned_distance_m ?? 0), 0) / 1000;
  const doneSessions = weekSessions.filter((s) => s.status === "completed");
  const doneKm = doneSessions.reduce((n, s) => n + (s.planned_distance_m ?? 0), 0) / 1000;
  const weekIndex =
    sessions.length > 0
      ? Math.max(
          1,
          Math.round(
            (new Date(`${weekStart}T12:00:00`).getTime() -
              new Date(`${mondayOf(new Date(`${sessions[0].day}T12:00:00`))}T12:00:00`).getTime()) /
              (7 * 86_400_000),
          ) + 1,
        )
      : 1;
  const totalWeeks = new Set(
    sessions.map((s) => mondayOf(new Date(`${s.day}T12:00:00`))),
  ).size;

  // Bewijs-chips: alleen tonen wat we echt kunnen aanwijzen.
  const sleep7 = series
    .slice(-7)
    .map((w) => w.sleep_total_s)
    .filter((v): v is number => v != null);
  const sleepAvg = sleep7.length
    ? sleep7.reduce((a, b) => a + b, 0) / sleep7.length / 3600
    : null;
  const sleepThreshold = rules.sleep_7d_below_threshold?.threshold_h ?? 6;
  const readinessThreshold = rules.readiness_gate_quality?.min_readiness ?? 50;

  const chips: { text: string; tone: string }[] = [];
  if (sleepAvg != null && sleepAvg < sleepThreshold) {
    chips.push({
      text: `slaapdrempel · ${sleepAvg.toFixed(1)} u van ${sleepThreshold.toFixed(1)}`,
      tone: "text-warning border-warning/40",
    });
  }
  if (
    latest?.training_readiness_score != null &&
    latest.training_readiness_score < readinessThreshold
  ) {
    chips.push({
      text: `trainingsfitheid · ${latest.training_readiness_score} van ${readinessThreshold}`,
      tone: "text-danger border-danger/40",
    });
  }

  const recentSeries = series.slice(-14);
  const meta = session ? SESSION_META[session.session_type] : null;
  const preWorkoutCheck =
    session && session.day === selectedDay && session.session_type !== "rest"
      ? buildPreWorkoutCheck({
          session,
          selectedDay,
          wellness,
          trainingLoad,
          feedback: recentFeedback,
          rules,
        })
      : null;
  const steps = session?.structure?.steps ?? [];
  const sessionPace =
    paceTarget(
      steps.find((s) => ["work", "run"].includes(s.type) && paceTarget(s) !== null) ?? {},
    ) ?? null;

  const initials = (athlete?.display_name ?? "JV")
    .split(" ")
    .map((part: string) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const completion = weekSessions.length ? (doneSessions.length / weekSessions.length) * 100 : 0;

  return (
    <main className="space-y-4">
      <TodayHeader
        initials={initials}
        lastSyncAt={lastSync?.finished_at}
        selectedDay={selectedDay}
        today={today}
      />

      {proposed ? (
        <PlanApproval
          plan={proposed}
          currentPlan={plan}
          changes={proposedChanges}
          adjustments={proposedAdjustments}
          sessions={proposedSessions}
        />
      ) : null}

      <section aria-labelledby="scores-heading">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="label">Jouw dag</div>
            <h1 id="scores-heading" className="mt-1 text-xl font-semibold tracking-[-0.025em]">
              Biometrische status
            </h1>
          </div>
          <Badge variant="outline">
            {latest
              ? `Meting ${new Date(`${latest.day}T12:00:00`).toLocaleDateString("nl-BE", {
                  day: "numeric",
                  month: "short",
                })}`
              : "Geen meting"}
          </Badge>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <BiometricMetricDrawer
            kind="readiness"
            latest={latest}
            series={series}
            selectedDay={selectedDay}
            tone={readiness}
          />
          <BiometricMetricDrawer
            kind="sleep"
            latest={latest}
            series={series}
            selectedDay={selectedDay}
            tone={sleep}
          />
          <BiometricMetricDrawer
            kind="hrv"
            latest={latest}
            series={series}
            selectedDay={selectedDay}
            tone={hrv}
          />
        </div>
      </section>

      <DetailDrawer
        title="Dagadvies"
        subtitle="Gebaseerd op je laatste Garmin-meting en coachregels"
        triggerClassName="focus-ring block w-full rounded-card text-left"
        trigger={
          <Card className="surface-pressable border-line-strong p-4">
            <div className="flex items-start gap-3.5">
              <div className="grid size-10 shrink-0 place-items-center rounded-full bg-teal/10 text-teal">
                <Sparkles className="size-[18px]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="label mb-1.5">Dagadvies</div>
                <div className={`text-[16px] font-semibold ${readiness.color}`}>
                  Trainingsfitheid: {readiness.label.toLowerCase()}
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">
                  {statusLine(latest?.training_readiness_score, latest?.hrv_status)}
                </p>
              </div>
              <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-faint" />
            </div>
          </Card>
        }
      >
        <div className="space-y-4 pt-3">
          <p className="text-[13px] leading-relaxed text-muted">
            {statusLine(latest?.training_readiness_score, latest?.hrv_status)}
          </p>
          {chips.length ? (
            <div>
              <div className="label mb-2">Signalen die meetellen</div>
              <div className="flex flex-wrap gap-2">
                {chips.map((chip) => (
                  <Badge key={chip.text} variant={chip.tone.includes("danger") ? "danger" : "warning"}>
                    {chip.text}
                  </Badge>
                ))}
              </div>
            </div>
          ) : (
            <div className="row p-3 text-xs leading-relaxed text-muted">
              Geen actieve slaap- of trainingsfitheidswaarschuwing. Je normale trainingsregels blijven gelden.
            </div>
          )}
        </div>
      </DetailDrawer>

      <TrainingLoadCard summary={trainingLoad} />

      {plan ? (
        <PlanImpactCard
          plan={plan}
          previousPlan={previousPlan}
          changes={latestPlanChanges}
          adjustments={activeAdjustments}
          source={impactActivitySource}
          sessions={sessions}
          sync={planSync}
        />
      ) : null}

      {session && preWorkoutCheck ? (
        <PreWorkoutCheckCard check={preWorkoutCheck} session={session} />
      ) : null}

      <section aria-labelledby="training-heading">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="label">Volgende op je plan</div>
            <h2 id="training-heading" className="mt-1 text-lg font-semibold tracking-[-0.02em]">
              {session?.day === selectedDay
                ? selectedDay === today
                  ? "Vandaag trainen"
                  : "Training op deze dag"
                : "Komende training"}
            </h2>
          </div>
          <CalendarDays className="size-5 text-faint" />
        </div>

        {session && meta ? (
          <Card
            className="overflow-hidden"
            style={{ borderColor: `${meta.hex}42` }}
          >
            <Link href={`/plan/${session.id}`} className="surface-pressable focus-ring block rounded-card p-4">
              <div className="flex items-center justify-between gap-3">
                <Badge className={meta.badge}>
                  <span className={`size-1.5 rounded-full ${meta.dot}`} />
                  {meta.label}
                </Badge>
                {session.pushed_at ? (
                  <Badge variant="outline"><Watch className="size-3" /> op horloge</Badge>
                ) : (
                  <span className="text-[10px] font-semibold text-faint">
                    {session.day === today
                      ? "vandaag"
                      : session.day === selectedDay
                        ? "deze dag"
                        : session.day.slice(8)}
                  </span>
                )}
              </div>

              <h3 className="mt-4 text-[19px] font-semibold leading-tight tracking-[-0.025em]">{session.title}</h3>
              <div className="mt-4 flex gap-7">
                <Stat label="Duur" value={duration(session.planned_duration_s)} />
                <Stat label="Afstand" value={km(session.planned_distance_m)} />
                {/* Waarop hij stuurt: tempo bij kwaliteitswerk, hartslag bij de rest. */}
                {sessionPace ? (
                  <Stat label="Tempo" value={`${sessionPace}/km`} />
                ) : session.hr_cap ? (
                  <Stat label="HR-plafond" value={String(session.hr_cap)} tone="text-teal" />
                ) : null}
              </div>
              <StructureBar steps={steps} accent={meta.hex} />
              <Separator className="my-4" />
              <div className="flex items-center justify-between text-[13px] font-semibold text-muted">
                <span>Workout bekijken</span>
                <ArrowUpRight className="size-4" />
              </div>
            </Link>
          </Card>
        ) : (
          <Card className="p-4 text-sm text-muted">
            {plan ? "Geen komende sessies in dit plan." : "Nog geen actief plan."}
          </Card>
        )}
      </section>

      {weekSessions.length > 0 ? (
        <section aria-labelledby="week-heading">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <div className="label">Trainingsblok</div>
              <h2 id="week-heading" className="mt-1 text-lg font-semibold">Deze week</h2>
            </div>
            <span className="text-[11px] font-semibold text-faint">week {weekIndex} van {totalWeeks}</span>
          </div>
          <Card className="p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="flex items-baseline gap-1.5">
                  <span className="metric-title">{doneKm.toFixed(1)}</span>
                  <span className="text-xs font-medium text-faint">/ {plannedKm.toFixed(1)} km</span>
                </div>
                <div className="mt-1 text-[11px] text-muted">{doneSessions.length} van {weekSessions.length} sessies afgerond</div>
              </div>
              <Badge variant="teal">{Math.round(completion)}%</Badge>
            </div>
            <Progress value={completion} className="mt-4" />

            <div className="mt-4 flex gap-1.5">
              {["M", "D", "W", "D", "V", "Z", "Z"].map((letter, i) => {
                const d = new Date(`${weekStart}T12:00:00`);
                d.setDate(d.getDate() + i);
                const iso = d.toISOString().slice(0, 10);
                const daySession = weekSessions.find((x) => x.day === iso);
                const dayMeta = daySession ? SESSION_META[daySession.session_type] : null;
                const isSelected = iso === selectedDay;
                const isDone = daySession?.status === "completed";
                return (
                  <div key={iso} className="flex flex-1 flex-col items-center gap-1.5">
                    <span className={`text-[9px] font-semibold ${isSelected ? "text-ink" : "text-faint"}`}>{letter}</span>
                    <div className={`relative h-8 w-full rounded-lg ${dayMeta ? dayMeta.dot : "bg-s3/70"} ${!daySession ? "opacity-40" : ""} ${isSelected ? "brightness-110" : ""}`}>
                      {isDone ? <span className="absolute inset-x-1 bottom-1 h-0.5 rounded-full bg-canvas/65" /> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="trends-heading">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <div className="label">Gezondheid</div>
            <h2 id="trends-heading" className="mt-1 text-lg font-semibold">Snelle trends</h2>
          </div>
          <Button asChild variant="ghost" size="sm" className="-mr-2 text-faint">
            <Link href="/activiteiten">Bekijk historie <ArrowUpRight /></Link>
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <HealthMetricDrawer kind="body_battery" wellness={series} selectedDay={selectedDay} />
          <HealthMetricDrawer kind="stress" wellness={series} selectedDay={selectedDay} />
          <HealthMetricDrawer kind="steps" wellness={series} selectedDay={selectedDay} />
          <HealthMetricDrawer kind="resting_hr" wellness={series} selectedDay={selectedDay} />
          <HealthMetricDrawer kind="sleep_score" wellness={series} selectedDay={selectedDay} />
          <HealthMetricDrawer kind="vo2max" wellness={series} vo2max={vo2maxSeries} selectedDay={selectedDay} />
        </div>
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  tone = "text-ink",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium text-faint">{label}</div>
      <div className={`numeral text-[19px] font-semibold ${tone}`}>{value}</div>
    </div>
  );
}
