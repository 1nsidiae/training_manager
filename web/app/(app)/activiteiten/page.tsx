import Link from "next/link";
import {
  Activity as ActivityIcon,
  BarChart3,
  Bike,
  Dumbbell,
  Footprints,
  ListFilter,
  Waves,
} from "lucide-react";
import { ActivityPagination } from "@/components/activity-pagination";
import { ActivityDrawer } from "@/components/activity-drawer";
import { HistoryTabs } from "@/components/history-tabs";
import { InteractiveBarChart, type InteractiveBarDatum } from "@/components/interactive-bar-chart";
import { ScreenHeader } from "@/components/screen-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getActivePlan,
  getActivitiesPage,
  getActivityArchiveSummary,
  getActivityFeedback,
  getActivityZones,
  getPlanSessions,
  getPlanSessionsForActivities,
  getRecentWellness,
  getWeeks,
  type Activity,
  type PlanSession,
} from "@/lib/queries";
import { ZONE_COLORS, duration, hours, km, pace } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const SPORT_FILTERS = [
  { value: "all", label: "Alles" },
  { value: "running", label: "Hardlopen" },
  { value: "cycling", label: "Fietsen" },
  { value: "swimming", label: "Zwemmen" },
  { value: "walking", label: "Wandelen" },
  { value: "strength", label: "Kracht" },
  { value: "other", label: "Overig" },
] as const;

const SPORT_LABEL: Record<string, string> = {
  running: "Hardlopen",
  cycling: "Fietsen",
  swimming: "Zwemmen",
  walking: "Wandelen",
  strength: "Kracht",
  other: "Overige activiteit",
};

const SUB_SPORT_LABEL: Record<string, string> = {
  running: "Hardlopen",
  treadmill_running: "Loopband",
  trail_running: "Trailrun",
  track_running: "Baanlopen",
  indoor_running: "Indoor hardlopen",
  cycling: "Fietsen",
  road_biking: "Wielrennen",
  indoor_cycling: "Indoor fietsen",
  mountain_biking: "Mountainbiken",
  gravel_cycling: "Gravelfietsen",
  virtual_ride: "Virtueel fietsen",
  lap_swimming: "Banenzwemmen",
  open_water_swimming: "Openwaterzwemmen",
  walking: "Wandelen",
  casual_walking: "Wandelen",
  speed_walking: "Snelwandelen",
  hiking: "Hiken",
  strength_training: "Krachttraining",
  indoor_cardio: "Indoor cardio",
  resort_snowboarding: "Snowboarden",
  soccer: "Voetbal",
};

const SPORT_TONE: Record<string, { icon: typeof ActivityIcon; className: string }> = {
  running: { icon: ActivityIcon, className: "bg-strain/10 text-strain" },
  cycling: { icon: Bike, className: "bg-run-cross/10 text-run-cross" },
  swimming: { icon: Waves, className: "bg-run-long/10 text-run-long" },
  walking: { icon: Footprints, className: "bg-teal/10 text-teal" },
  strength: { icon: Dumbbell, className: "bg-run-strength/10 text-run-strength" },
  other: { icon: ActivityIcon, className: "bg-recovery/10 text-recovery" },
};

type PageQuery = {
  page?: string | string[];
  perPage?: string | string[];
  sport?: string | string[];
  view?: string | string[];
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function activityKind(activity: Activity) {
  return SUB_SPORT_LABEL[activity.sub_sport ?? ""] ?? SPORT_LABEL[activity.sport] ?? "Activiteit";
}

function activityTitle(activity: Activity) {
  return activity.name?.trim() || activityKind(activity);
}

function monthKey(value: string) {
  return value.slice(0, 7);
}

function monthLabel(value: string) {
  return new Date(`${value}-01T12:00:00`).toLocaleDateString("nl-BE", {
    month: "long",
    year: "numeric",
  });
}

function fullDate(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("nl-BE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function compactDateTime(value: string) {
  const date = new Date(value);
  const datePart = date.toLocaleDateString("nl-BE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const timePart = date.toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" });
  return `${datePart} · ${timePart}`;
}

function weekRange(iso: string) {
  const start = new Date(`${iso}T12:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const startLabel = start.toLocaleDateString("nl-BE", { day: "numeric", month: "short" });
  const endLabel = end.toLocaleDateString("nl-BE", { day: "numeric", month: "short", year: "numeric" });
  return `${startLabel} – ${endLabel}`;
}

function matchSession(activity: Activity, sessions: PlanSession[]) {
  const linked = sessions.find((session) => session.activity_id === activity.id);
  if (linked) return linked;

  const activityDay = activity.start_time_local.slice(0, 10);
  const candidates = sessions.filter(
    (session) =>
      session.activity_id == null &&
      (session.status === "planned" || session.status === "moved") &&
      session.day === activityDay &&
      session.sport === activity.sport,
  );
  if (candidates.length <= 1) return candidates[0] ?? null;

  return candidates.sort((a, b) => matchDistance(activity, a) - matchDistance(activity, b))[0];
}

function matchDistance(activity: Activity, session: PlanSession) {
  const distanceDelta =
    activity.distance_m && session.planned_distance_m
      ? Math.abs(activity.distance_m - session.planned_distance_m) /
        Math.max(activity.distance_m, session.planned_distance_m)
      : 1;
  const durationDelta =
    activity.duration_s && session.planned_duration_s
      ? Math.abs(activity.duration_s - session.planned_duration_s) /
        Math.max(activity.duration_s, session.planned_duration_s)
      : 1;
  return Math.min(distanceDelta, durationDelta);
}

function viewHref(view: "archive" | "trends", sport: string) {
  if (view === "trends") return "/activiteiten?view=trends";
  return sport === "all" ? "/activiteiten" : `/activiteiten?sport=${sport}`;
}

function ViewSwitch({ current, sport }: { current: "archive" | "trends"; sport: string }) {
  return (
    <Tabs value={current}>
      <TabsList aria-label="Activiteitenweergave">
        <TabsTrigger value="archive" asChild>
          <Link href={viewHref("archive", sport)}>
            <ListFilter /> Activiteiten
          </Link>
        </TabsTrigger>
        <TabsTrigger value="trends" asChild>
          <Link href={viewHref("trends", sport)}>
            <BarChart3 /> Trends
          </Link>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

export default async function ActivitiesPage({ searchParams }: { searchParams: Promise<PageQuery> }) {
  const query = await searchParams;
  const view = firstValue(query.view) === "trends" ? "trends" : "archive";
  const requestedSport = firstValue(query.sport) ?? "all";
  const sport = SPORT_FILTERS.some((filter) => filter.value === requestedSport) ? requestedSport : "all";

  if (view === "trends") return <TrendsView sport={sport} />;

  const requestedPage = Math.max(1, Number.parseInt(firstValue(query.page) ?? "1", 10) || 1);
  const requestedPageSize = Number.parseInt(firstValue(query.perPage) ?? "10", 10);
  const pageSize = [5, 10, 20].includes(requestedPageSize) ? requestedPageSize : 10;
  const plan = await getActivePlan();
  const [activityPage, archive, sessions] = await Promise.all([
    getActivitiesPage(requestedPage, pageSize, sport),
    getActivityArchiveSummary(),
    plan ? getPlanSessions(plan.id) : Promise.resolve([]),
  ]);
  const { activities, total, page } = activityPage;
  const [zones, feedback, linkedSessions] = await Promise.all([
    getActivityZones(activities.map((activity) => activity.id)),
    getActivityFeedback(activities.map((activity) => activity.id)),
    getPlanSessionsForActivities(activities.map((activity) => activity.id)),
  ]);
  const sessionPool = [
    ...linkedSessions,
    ...sessions.filter((session) => !linkedSessions.some((linked) => linked.id === session.id)),
  ];

  const grouped = new Map<string, Activity[]>();
  for (const activity of activities) {
    const key = monthKey(activity.start_time_local);
    grouped.set(key, [...(grouped.get(key) ?? []), activity]);
  }
  const firstMonth = archive.firstActivityAt
    ? new Date(archive.firstActivityAt).toLocaleDateString("nl-BE", { month: "long", year: "numeric" })
    : null;

  return (
    <main className="space-y-5">
      <ScreenHeader
        eyebrow="Garmin Connect"
        title="Activiteiten"
        description={
          firstMonth
            ? `${archive.total} activiteiten sinds ${firstMonth}. Elke sport blijft zichtbaar en telt mee als trainingscontext.`
            : "Al je Garmin-activiteiten, ongeacht de sport."
        }
      />

      <ViewSwitch current="archive" sport={sport} />

      <section id="activiteiten" className="scroll-mt-4">
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Filter op sport">
          {SPORT_FILTERS.map((filter) => {
            const active = filter.value === sport;
            const href = filter.value === "all" ? "/activiteiten" : `/activiteiten?sport=${filter.value}`;
            return (
              <Link
                key={filter.value}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-ring flex h-9 shrink-0 items-center rounded-full border px-3.5 text-[11px] font-semibold transition-colors",
                  active
                    ? "border-ink bg-ink text-canvas"
                    : "border-line bg-s1 text-muted hover:border-line-strong hover:text-ink",
                )}
              >
                {filter.label}
              </Link>
            );
          })}
        </div>

        <div className="mt-5 space-y-6">
          {[...grouped.entries()].map(([month, monthActivities]) => (
            <section key={month}>
              <div className="mb-2.5 flex items-center justify-between gap-3 px-0.5">
                <h2 className="label text-muted">{monthLabel(month)}</h2>
                <span className="text-[10px] font-medium text-faint">
                  {monthActivities.length} {monthActivities.length === 1 ? "activiteit" : "activiteiten"}
                </span>
              </div>
              <div className="space-y-2">
                {monthActivities.map((activity) => {
                  const activityZones = zones.get(activity.id) ?? [0, 0, 0, 0, 0];
                  const activityFeedback = feedback.get(activity.id) ?? null;
                  const matchedSession = matchSession(activity, sessionPool);
                  const zoneTotal = activityZones.reduce((sum, value) => sum + value, 0);
                  const tone = SPORT_TONE[activity.sport] ?? SPORT_TONE.other;
                  const Icon = tone.icon;
                  const hasDistance = (activity.distance_m ?? 0) >= 100;

                  return (
                    <ActivityDrawer
                      key={activity.id}
                      activity={activity}
                      zones={activityZones}
                      feedback={activityFeedback}
                      matchedSession={matchedSession}
                    >
                      <Card className="surface-pressable rounded-[15px] p-3">
                        <div className="flex items-center gap-3">
                          <div className={cn("grid size-10 shrink-0 place-items-center rounded-full", tone.className)}>
                            <Icon className="size-[18px]" strokeWidth={1.8} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-semibold text-ink">{activityTitle(activity)}</div>
                            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-faint">
                              <span className="truncate">{activityKind(activity)}</span>
                              <span aria-hidden>·</span>
                              <span className="shrink-0">{compactDateTime(activity.start_time_local)}</span>
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="numeral text-[16px] font-bold text-ink">
                              {hasDistance ? km(activity.distance_m) : duration(activity.duration_s)}
                            </div>
                            <div className="numeral mt-1 text-[9px] font-medium text-faint">
                              {hasDistance ? duration(activity.duration_s) : activity.calories ? `${activity.calories} kcal` : "Garmin"}
                              {activity.avg_hr ? ` · ${activity.avg_hr} bpm` : ""}
                            </div>
                          </div>
                        </div>
                        {zoneTotal > 0 ? (
                          <div className="mt-3 flex h-1 gap-px overflow-hidden rounded-full bg-s3/50">
                            {activityZones.map((seconds, index) =>
                              seconds > 0 ? (
                                <div
                                  key={index}
                                  style={{ width: `${(seconds / zoneTotal) * 100}%`, background: ZONE_COLORS[index] }}
                                />
                              ) : null,
                            )}
                          </div>
                        ) : null}
                      </Card>
                    </ActivityDrawer>
                  );
                })}
              </div>
            </section>
          ))}

          {activities.length === 0 ? (
            <Card className="p-5 text-center">
              <div className="text-sm font-semibold">Geen activiteiten in deze categorie</div>
              <p className="mt-1 text-xs text-muted">Na de volgende Garmin-sync verschijnen ze hier automatisch.</p>
            </Card>
          ) : null}
        </div>

        <ActivityPagination page={page} pageSize={pageSize} total={total} />
      </section>
    </main>
  );
}

async function TrendsView({ sport }: { sport: string }) {
  const [weeks, wellness] = await Promise.all([getWeeks(10), getRecentWellness(14)]);
  const nights = [...wellness].reverse();
  const kilometer = new Intl.NumberFormat("nl-BE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const weekBars: InteractiveBarDatum[] = weeks.map((week) => {
    const value = week.distance_m / 1000;
    return {
      id: week.week_start,
      eyebrow: "Hardloopvolume",
      dateLabel: weekRange(week.week_start),
      valueLabel: `${kilometer.format(value)} km`,
      value,
      color: "#0093e7",
      axisLabel: week.week_start.slice(8),
      muted: value === 0,
    };
  });
  const sleepBars: InteractiveBarDatum[] = nights.map((night) => {
    const sleepHours = (night.sleep_total_s ?? 0) / 3600;
    const measured = night.sleep_total_s != null;
    return {
      id: night.day,
      eyebrow: "Slaapduur",
      dateLabel: fullDate(night.day),
      valueLabel: measured ? hours(night.sleep_total_s) : "Geen slaapmeting",
      value: measured ? sleepHours : null,
      color: !measured ? "#303b41" : sleepHours >= 6 ? "#7ba1bb" : "#ff0026",
      axisLabel: night.day.slice(8),
      muted: !measured,
    };
  });
  const measuredWeekVolumes = weekBars.map((item) => item.value).filter((value): value is number => value != null);
  const weekAverage = measuredWeekVolumes.length
    ? measuredWeekVolumes.reduce((sum, value) => sum + value, 0) / measuredWeekVolumes.length
    : null;
  const measuredSleep = sleepBars.map((item) => item.value).filter((value): value is number => value != null);
  const sleepAverage = measuredSleep.length
    ? measuredSleep.reduce((sum, value) => sum + value, 0) / measuredSleep.length
    : null;

  return (
    <main className="space-y-5">
      <ScreenHeader
        eyebrow="Historie"
        title="Trends"
        description="Zie hoe je hardloopvolume en herstel over tijd evolueren. Andere sporten tellen mee in je totale belasting."
      />
      <ViewSwitch current="trends" sport={sport} />
      <HistoryTabs
        training={
          <Card className="p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="label">Hardloopvolume</div>
                <div className="mt-1 text-sm font-semibold">Laatste 10 weken</div>
              </div>
              <Badge variant="strain">kilometers</Badge>
            </div>
            <InteractiveBarChart
              data={weekBars}
              ariaLabel="Hardloopvolume in kilometer; tik op een week voor de exacte periode"
              average={weekAverage != null ? {
                value: weekAverage,
                label: `10-weeks gemiddelde ${kilometer.format(weekAverage)} km`,
                color: "#67aee6",
              } : undefined}
            />
            <p className="mt-4 text-xs leading-relaxed text-muted">
              Alleen hardloopkilometers sturen je volume-opbouw. Zwemmen, fietsen, wandelen en kracht tellen wel mee in belasting en herstel.
            </p>
          </Card>
        }
        recovery={
          <Card className="p-4">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <div className="label">Slaapduur</div>
                <div className="mt-1 text-sm font-semibold">Laatste 14 nachten</div>
              </div>
              <Badge variant="sleep">uren</Badge>
            </div>
            <InteractiveBarChart
              data={sleepBars}
              ariaLabel="Slaapduur per nacht; tik op een balk voor de datum en duur"
              average={sleepAverage != null ? {
                value: sleepAverage,
                label: `14-nachts gemiddelde ${sleepAverage.toFixed(1).replace(".", ",")} u`,
                color: "#7ba1bb",
              } : undefined}
              threshold={{ value: 6, label: "Coachdrempel 6,0 u", color: "#ff0026" }}
            />
            <p className="mt-4 text-xs leading-relaxed text-muted">
              Rood is minder dan zes uur. Zakt je 7-daags gemiddelde onder 6,0 uur, dan begrenst de coach je weekvolume.
            </p>
          </Card>
        }
      />
    </main>
  );
}
