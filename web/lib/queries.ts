import { createClient } from "@/lib/supabase/server";
import {
  buildTrainingLoadSummary,
  estimateActivityLoad,
  type LoadActivityRow,
} from "@/lib/training-load";

export type {
  HeavyRunImpact,
  LoadDataQuality,
  TrainingLoadDay,
  TrainingLoadSource,
  TrainingLoadSport,
  TrainingLoadSummary,
} from "@/lib/training-load";
import type { TrainingLoadSource, TrainingLoadSummary } from "@/lib/training-load";

export type SessionType =
  | "rest"
  | "recovery"
  | "easy"
  | "long"
  | "tempo"
  | "interval"
  | "walk_run"
  | "race"
  | "strength"
  | "cross_training";

export type PlanSession = {
  id: number;
  plan_id: number;
  sport: string;
  day: string;
  session_type: SessionType;
  title: string;
  description: string | null;
  planned_distance_m: number | null;
  planned_duration_s: number | null;
  hr_cap: number | null;
  status: string;
  activity_id: number | null;
  structure: { steps?: Step[] } | null;
  targets: {
    target_type?: string;
    compliance?: SessionCompliance;
    [key: string]: unknown;
  } | null;
  garmin_workout_id: number | null;
  garmin_schedule_id: number | null;
  pushed_at: string | null;
  push_error: string | null;
};

export type WorkoutConflict = {
  id: number;
  pwa_day: string;
  garmin_day: string | null;
  garmin_schedule_id: number | null;
};

const SESSION_COLUMNS =
  "id, plan_id, sport, day, session_type, title, description, planned_distance_m, " +
  "planned_duration_s, hr_cap, status, activity_id, structure, targets, garmin_workout_id, " +
  "garmin_schedule_id, pushed_at, push_error";

export type Step = {
  type: string;
  repeat: number;
  duration_s: number;
  distance_m: number;
  hr_min: number;
  hr_max: number;
  /** Seconden per kilometer; 0 betekent geen tempodoel. */
  pace_min_s_per_km?: number;
  pace_max_s_per_km?: number;
  note: string;
};

export type SessionCompliance = {
  version: number;
  status: "unknown" | "met" | "partial" | "missed";
  reasons: string[];
  completion_ratio: number | null;
  planned_distance_m: number | null;
  actual_distance_m: number | null;
  planned_duration_s: number | null;
  actual_duration_s: number | null;
  hr_cap: number | null;
  avg_hr: number | null;
  hr_delta: number | null;
  pace_target_fast_s_per_km: number | null;
  pace_target_slow_s_per_km: number | null;
  actual_pace_s_per_km: number | null;
  pace_target_coverage: number;
};

export type Wellness = {
  day: string;
  sleep_total_s: number | null;
  sleep_deep_s: number | null;
  sleep_light_s: number | null;
  sleep_rem_s: number | null;
  sleep_awake_s: number | null;
  sleep_score: number | null;
  hrv_last_night_avg: number | null;
  hrv_status: string | null;
  hrv_baseline_low: number | null;
  hrv_baseline_high: number | null;
  training_readiness_score: number | null;
  training_readiness_level: string | null;
  resting_hr: number | null;
  body_battery_high: number | null;
  body_battery_low: number | null;
  avg_stress: number | null;
  steps: number | null;
  synced_at: string | null;
  raw: {
    daily_summary?: Record<string, unknown>;
    sleep_detail?: {
      start_local_ms: number | null;
      end_local_ms: number | null;
      levels: {
        start_gmt: string;
        end_gmt: string;
        level: number;
      }[];
    };
    steps_detail?: {
      buckets: {
        start_gmt: string;
        end_gmt: string;
        steps: number;
      }[];
    };
    intraday_detail?: {
      stress: { timestamp_ms: number; value: number }[];
      body_battery: { timestamp_ms: number; value: number }[];
      heart_rate: { timestamp_ms: number; value: number }[];
    };
  } | null;
};

const WELLNESS_COLUMNS =
  "day, sleep_total_s, sleep_deep_s, sleep_light_s, sleep_rem_s, sleep_awake_s, sleep_score, hrv_last_night_avg, hrv_status, hrv_baseline_low, hrv_baseline_high, training_readiness_score, training_readiness_level, resting_hr, body_battery_high, body_battery_low, avg_stress, steps, synced_at, raw";

export type WeekMetrics = {
  week_start: string;
  distance_m: number;
  session_count: number;
  easy_share: number | null;
  acwr: number | null;
  avg_sleep_s: number | null;
  avg_readiness: number | null;
  hrv_unbalanced_days: number;
  zone1_s: number;
  zone2_s: number;
  zone3_s: number;
  zone4_s: number;
  zone5_s: number;
};

export type Adjustment = {
  id: number;
  plan_session_id: number | null;
  rule: string;
  severity: "info" | "limit" | "override";
  explanation: { nl: string; en: string };
  evidence: Record<string, unknown>;
};

export type CoachRule = {
  key: string;
  class: "core" | "tunable" | "learned";
  status: string;
  title: { nl: string; en: string };
  rationale: { nl: string; en: string };
  params: Record<string, number>;
  user_pinned: boolean;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export type Plan = {
  id: number;
  goal_id: number;
  version: number;
  summary: string | null;
  reason: string | null;
  trigger: string;
  status: "active" | "proposed" | "superseded";
  created_at: string;
};

export type PlanSyncLog = {
  id: number;
  sync_type: string;
  status: "requested" | "running" | "ok" | "error";
  items_synced: number | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export type GoalPlanRequest = {
  id: number;
  sync_type: string;
  status: "requested" | "running" | "ok" | "error";
  error: string | null;
};

export type CoachMessage = {
  id: number;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  intent: "question" | "report" | "plan_review";
  metadata: {
    needs_plan_review?: boolean;
    review_reason?: string;
    safety_note?: string;
    model?: string;
    input_tokens?: number;
    output_tokens?: number;
    cost_usd?: number;
    [key: string]: unknown;
  };
  created_at: string;
};

export async function getActivePlan() {
  const sb = await createClient();
  const { data } = await sb
    .from("plans")
    .select("id, goal_id, version, summary, reason, trigger, status, created_at")
    .eq("status", "active")
    .maybeSingle();
  return data as Plan | null;
}

/** Een nieuwe versie die naast het huidige plan op een keuze wacht. */
export async function getProposedPlan() {
  const sb = await createClient();
  const { data } = await sb
    .from("plans")
    .select("id, goal_id, version, summary, reason, trigger, status, created_at")
    .eq("status", "proposed")
    .maybeSingle();
  return data as Plan | null;
}

/** Laatste doelwizardtaak, zodat de voortgang ook na navigeren zichtbaar blijft. */
export async function getLatestGoalPlanRequest() {
  const sb = await createClient();
  const { data } = await sb
    .from("sync_log")
    .select("id, sync_type, status, error")
    .like("sync_type", "goal_plan_review:%")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as GoalPlanRequest | null;
}

export async function getPreviousPlan(plan: Plan) {
  const sb = await createClient();
  const { data } = await sb
    .from("plans")
    .select("id, goal_id, version, summary, reason, trigger, status, created_at")
    .eq("goal_id", plan.goal_id)
    .lt("version", plan.version)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as Plan | null;
}

export async function getPlanHistory(goalId: number, limit = 8) {
  const sb = await createClient();
  const { data } = await sb
    .from("plans")
    .select("id, goal_id, version, summary, reason, trigger, status, created_at")
    .eq("goal_id", goalId)
    .order("version", { ascending: false })
    .limit(limit);
  return (data ?? []) as Plan[];
}

/** Laatste batch waarmee een goedgekeurde planversie naar Garmin ging. */
export async function getPlanApplySync(planId: number) {
  const sb = await createClient();
  const { data } = await sb
    .from("sync_log")
    .select("id, sync_type, status, items_synced, error, started_at, finished_at")
    .like("sync_type", `plan_apply:${planId}:%`)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as PlanSyncLog | null;
}

export async function getPlanSessions(planId: number) {
  const sb = await createClient();
  const { data } = await sb
    .from("plan_sessions")
    .select(SESSION_COLUMNS)
    .eq("plan_id", planId)
    .order("day");
  // Kolommen komen uit een constante, dus supabase-js kan de rijvorm niet
  // afleiden; de cast is hier bewust en het type staat hierboven.
  return (data ?? []) as unknown as PlanSession[];
}

/** Gekoppelde plansessies blijven nodig nadat hun plan door een herplanning is
 * vervangen; anders zou de doelcontrole bij de activiteit verdwijnen. */
export async function getPlanSessionsForActivities(activityIds: number[]) {
  if (!activityIds.length) return [];
  const sb = await createClient();
  const { data } = await sb
    .from("plan_sessions")
    .select(SESSION_COLUMNS)
    .in("activity_id", activityIds);
  return (data ?? []) as unknown as PlanSession[];
}

export async function getSession(id: number) {
  const sb = await createClient();
  const { data } = await sb
    .from("plan_sessions")
    .select(SESSION_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  return data as unknown as PlanSession | null;
}

export async function getWorkoutConflict(sessionId: number) {
  const sb = await createClient();
  const { data } = await sb
    .from("sync_log")
    .select("id, error")
    .like("sync_type", `workout_conflict:${sessionId}:%`)
    .eq("status", "error")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.error) return null;
  try {
    const parsed = JSON.parse(data.error) as Omit<WorkoutConflict, "id">;
    return { id: data.id, ...parsed } as WorkoutConflict;
  } catch {
    return null;
  }
}

export async function getGoal() {
  const sb = await createClient();
  const { data } = await sb
    .from("goals")
    .select("id, goal_type, name, target_date, target_distance_m, target_time_s, params")
    .eq("status", "active")
    .maybeSingle();
  return data;
}

/** Drempelwaarden uit de actieve regels, voor bewijs-chips in de UI. */
export async function getRuleParams() {
  const sb = await createClient();
  const { data } = await sb
    .from("coach_rules")
    .select("key, params")
    .eq("status", "active");
  const out: Record<string, Record<string, number>> = {};
  for (const r of data ?? []) out[r.key] = r.params ?? {};
  return out;
}

/** Sessie van vandaag, of anders de eerstvolgende. */
export async function getNextSession(planId: number) {
  const sb = await createClient();
  const { data } = await sb
    .from("plan_sessions")
    .select(SESSION_COLUMNS)
    .eq("plan_id", planId)
    .in("status", ["planned", "moved"])
    .gte("day", today())
    .order("day")
    .limit(1)
    .maybeSingle();
  return data as unknown as PlanSession | null;
}

export async function getRecentWellness(days = 14) {
  const sb = await createClient();
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const { data } = await sb
    .from("wellness_daily")
    .select(WELLNESS_COLUMNS)
    .gte("day", from)
    .order("day", { ascending: false });
  return (data ?? []) as Wellness[];
}

/** Dagmetingen tot en met een gekozen dag, voor historische dagnavigatie. */
export async function getWellnessWindow(endDay: string, days = 14) {
  const fromDate = new Date(`${endDay}T12:00:00Z`);
  fromDate.setUTCDate(fromDate.getUTCDate() - Math.max(days - 1, 0));
  const from = fromDate.toISOString().slice(0, 10);
  const sb = await createClient();
  const { data } = await sb
    .from("wellness_daily")
    .select(WELLNESS_COLUMNS)
    .gte("day", from)
    .lte("day", endDay)
    .order("day", { ascending: false });
  return (data ?? []) as Wellness[];
}

export async function getWeeks(limit = 12) {
  const sb = await createClient();
  const { data } = await sb
    .from("weekly_metrics")
    .select(
      "week_start, distance_m, session_count, easy_share, acwr, avg_sleep_s, avg_readiness, hrv_unbalanced_days, zone1_s, zone2_s, zone3_s, zone4_s, zone5_s",
    )
    .order("week_start", { ascending: false })
    .limit(limit);
  return ((data ?? []) as WeekMetrics[]).reverse();
}

export async function getAdjustments(planId: number) {
  const sb = await createClient();
  const { data } = await sb
    .from("plan_adjustments")
    .select("id, plan_session_id, rule, severity, explanation, evidence")
    .eq("plan_id", planId)
    .order("id");
  return (data ?? []) as Adjustment[];
}

export async function getRules() {
  const sb = await createClient();
  const { data } = await sb
    .from("coach_rules")
    .select("key, class, status, title, rationale, params, user_pinned")
    .in("status", ["active", "proposed"])
    .order("class");
  return (data ?? []) as CoachRule[];
}

export type FitnessEstimate = {
  scope: "current" | "historical";
  equiv_5k_s: number | null;
  equiv_10k_s: number | null;
  equiv_half_s: number | null;
  equiv_marathon_s: number | null;
  vo2max: number | null;
  sample_size: number;
};

export async function getFitness() {
  const sb = await createClient();
  const { data } = await sb
    .from("fitness_estimates")
    .select("scope, equiv_5k_s, equiv_10k_s, equiv_half_s, equiv_marathon_s, vo2max, sample_size")
    .order("day", { ascending: false })
    .limit(6);
  return (data ?? []) as FitnessEstimate[];
}

export type Activity = {
  id: number;
  sport: string;
  sub_sport: string | null;
  name: string | null;
  start_time_local: string;
  distance_m: number | null;
  duration_s: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_pace_s_per_km: number | null;
  calories: number | null;
  elevation_gain_m: number | null;
};

const ACTIVITY_COLUMNS =
  "id, sport, sub_sport, name, start_time_local, distance_m, duration_s, " +
  "avg_hr, max_hr, avg_pace_s_per_km, calories, elevation_gain_m";

export type SessionFeedback = {
  id: number;
  plan_session_id: number | null;
  activity_id: number | null;
  pain_score: number;
  endurance_score: number;
  extra: { rpe?: number; feeling?: string; source?: string } | null;
  notes: string | null;
  created_at: string;
};

export type RecentTrainingFeedback = SessionFeedback & {
  session: Pick<PlanSession, "id" | "day" | "title" | "session_type" | "status" | "targets"> | null;
};

export async function getActivities(limit = 30) {
  const sb = await createClient();
  const { data } = await sb
    .from("activities")
    .select(ACTIVITY_COLUMNS)
    .order("start_time", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as Activity[];
}

/** Activiteiten binnen één kalenderperiode. De weekreview gebruikt bewust
 * alle sporten: een zwemsessie of krachttraining telt als trainingscontext,
 * ook wanneer alleen hardloopkilometers tegen het loopschema worden gezet. */
export async function getActivitiesWindow(fromDay: string, throughDay: string) {
  const end = new Date(`${throughDay}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const sb = await createClient();
  const { data } = await sb
    .from("activities")
    .select(ACTIVITY_COLUMNS)
    .gte("start_time_local", fromDay)
    .lt("start_time_local", end.toISOString().slice(0, 10))
    .order("start_time_local");
  return (data ?? []) as unknown as Activity[];
}

export async function getActivitiesPage(page = 1, pageSize = 10, sport?: string) {
  const safePage = Math.max(1, Math.trunc(page));
  const safePageSize = Math.max(1, Math.min(50, Math.trunc(pageSize)));
  const from = (safePage - 1) * safePageSize;
  const to = from + safePageSize - 1;
  const sb = await createClient();
  let query = sb
    .from("activities")
    .select(ACTIVITY_COLUMNS, { count: "exact" });
  if (sport && sport !== "all") query = query.eq("sport", sport);
  const { data, count } = await query
    .order("start_time", { ascending: false })
    .range(from, to);

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const resolvedPage = Math.min(safePage, totalPages);

  if (resolvedPage !== safePage) {
    const resolvedFrom = (resolvedPage - 1) * safePageSize;
    let resolvedQuery = sb
      .from("activities")
      .select(ACTIVITY_COLUMNS);
    if (sport && sport !== "all") resolvedQuery = resolvedQuery.eq("sport", sport);
    const { data: resolvedData } = await resolvedQuery
      .order("start_time", { ascending: false })
      .range(resolvedFrom, resolvedFrom + safePageSize - 1);

    return { activities: (resolvedData ?? []) as unknown as Activity[], total, page: resolvedPage };
  }

  return { activities: (data ?? []) as unknown as Activity[], total, page: resolvedPage };
}

export async function getActivityArchiveSummary() {
  const sb = await createClient();
  const { data, count } = await sb
    .from("activities")
    .select("start_time_local", { count: "exact" })
    .order("start_time", { ascending: true })
    .limit(1);
  return {
    total: count ?? 0,
    firstActivityAt: data?.[0]?.start_time_local as string | undefined,
  };
}

function addDays(day: string, amount: number) {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

/** Dezelfde belastingsberekening als de Python feature-laag, maar uitgesplitst
 * per sport zodat de interface kan laten zien waar de totale belasting vandaan komt. */
export async function getTrainingLoadSummary(endDay: string): Promise<TrainingLoadSummary> {
  const fromDay = addDays(endDay, -27);
  const untilDay = addDays(endDay, 1);
  const sb = await createClient();
  const { data } = await sb
    .from("activities")
    .select("id, sport, sub_sport, name, start_time_local, duration_s, raw")
    .gte("start_time_local", fromDay)
    .lt("start_time_local", untilDay)
    .order("start_time_local", { ascending: false });
  const rows = (data ?? []) as unknown as LoadActivityRow[];

  const zoneMap = new Map<number, number[]>();
  if (rows.length) {
    const { data: zoneRows } = await sb
      .from("activity_zones")
      .select("activity_id, zone_number, seconds_in_zone")
      .in("activity_id", rows.map((row) => row.id));
    for (const zone of zoneRows ?? []) {
      const values = zoneMap.get(zone.activity_id) ?? [0, 0, 0, 0, 0];
      values[zone.zone_number - 1] = Number(zone.seconds_in_zone) || 0;
      zoneMap.set(zone.activity_id, values);
    }
  }

  return buildTrainingLoadSummary(rows, zoneMap, endDay);
}

/** Garmin-activiteit die een activity_completed-herplanning activeerde. */
export async function getPlanActivitySource(plan: Plan): Promise<TrainingLoadSource | null> {
  if (plan.trigger !== "activity_completed") return null;
  const sb = await createClient();
  const { data: run } = await sb
    .from("coach_runs")
    .select("trigger_key")
    .eq("trigger", "activity_completed")
    .lte("created_at", plan.created_at)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const triggerDay = run?.trigger_key?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (!triggerDay) return null;

  const { data } = await sb
    .from("activities")
    .select("id, sport, sub_sport, name, start_time_local, duration_s, raw")
    .gte("start_time_local", triggerDay)
    .lt("start_time_local", addDays(triggerDay, 1))
    .neq("sport", "running");
  const rows = (data ?? []) as unknown as LoadActivityRow[];
  const source = rows.sort((a, b) => {
    const aLoad = Number(a.raw?.activityTrainingLoad ?? 0);
    const bLoad = Number(b.raw?.activityTrainingLoad ?? 0);
    return bLoad - aLoad || Number(b.duration_s ?? 0) - Number(a.duration_s ?? 0);
  })[0];
  if (!source) return null;
  const estimate = estimateActivityLoad(source);
  return {
    id: source.id,
    sport: source.sport,
    sub_sport: source.sub_sport,
    name: source.name,
    start_time_local: source.start_time_local,
    duration_s: Math.round(Number(source.duration_s) || 0),
    load: estimate.load > 0 ? estimate.load : null,
    loadSource: estimate.source,
  };
}

export async function getActivityZones(ids: number[]) {
  if (ids.length === 0) return new Map<number, number[]>();
  const sb = await createClient();
  const { data } = await sb
    .from("activity_zones")
    .select("activity_id, zone_number, seconds_in_zone")
    .in("activity_id", ids);

  const out = new Map<number, number[]>();
  for (const z of data ?? []) {
    const arr = out.get(z.activity_id) ?? [0, 0, 0, 0, 0];
    arr[z.zone_number - 1] = Number(z.seconds_in_zone) || 0;
    out.set(z.activity_id, arr);
  }
  return out;
}

export async function getActivityFeedback(ids: number[]) {
  if (ids.length === 0) return new Map<number, SessionFeedback>();
  const sb = await createClient();
  const { data } = await sb
    .from("session_feedback")
    .select(
      "id, plan_session_id, activity_id, pain_score, endurance_score, extra, notes, created_at",
    )
    .in("activity_id", ids)
    .order("created_at", { ascending: false });

  const out = new Map<number, SessionFeedback>();
  for (const row of (data ?? []) as SessionFeedback[]) {
    if (row.activity_id != null && !out.has(row.activity_id)) out.set(row.activity_id, row);
  }
  return out;
}

/** Laatste zelfrapportages met de bijbehorende doelcontrole. Dit is de
 * menselijke laag van de pre-workout check: Garmin ziet belasting, maar niet
 * of een training pijnlijk of buitensporig zwaar aanvoelde. */
export async function getRecentTrainingFeedback(limit = 6): Promise<RecentTrainingFeedback[]> {
  const sb = await createClient();
  const { data } = await sb
    .from("session_feedback")
    .select(
      "id, plan_session_id, activity_id, pain_score, endurance_score, extra, notes, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  const feedback = (data ?? []) as SessionFeedback[];
  const sessionIds = feedback
    .map((item) => item.plan_session_id)
    .filter((id): id is number => id != null);

  const sessions = new Map<number, RecentTrainingFeedback["session"]>();
  if (sessionIds.length) {
    const { data: sessionRows } = await sb
      .from("plan_sessions")
      .select("id, day, title, session_type, status, targets")
      .in("id", sessionIds);
    for (const row of sessionRows ?? []) {
      sessions.set(row.id, row as RecentTrainingFeedback["session"]);
    }
  }

  return feedback.map((item) => ({
    ...item,
    session: item.plan_session_id == null ? null : sessions.get(item.plan_session_id) ?? null,
  }));
}

/** Alle zelfrapportages van een plan, gekoppeld aan de trainingsdag. Dit
 * voorkomt dat een later ingevulde feedback in de verkeerde week belandt. */
export async function getPlanTrainingFeedback(planId: number): Promise<RecentTrainingFeedback[]> {
  const sb = await createClient();
  const { data: sessionRows } = await sb
    .from("plan_sessions")
    .select("id, day, title, session_type, status, targets")
    .eq("plan_id", planId);
  const sessions = (sessionRows ?? []) as NonNullable<RecentTrainingFeedback["session"]>[];
  const sessionIds = sessions.map((session) => session.id);
  if (!sessionIds.length) return [];

  const { data } = await sb
    .from("session_feedback")
    .select(
      "id, plan_session_id, activity_id, pain_score, endurance_score, extra, notes, created_at",
    )
    .in("plan_session_id", sessionIds)
    .order("created_at", { ascending: false });
  const sessionMap = new Map(sessions.map((session) => [session.id, session]));
  return ((data ?? []) as SessionFeedback[]).map((item) => ({
    ...item,
    session: item.plan_session_id == null ? null : sessionMap.get(item.plan_session_id) ?? null,
  }));
}

export async function getCoachRuns(limit = 20) {
  const sb = await createClient();
  const { data } = await sb
    .from("coach_runs")
    .select("id, trigger, model, cost_usd, retries, duration_ms, status, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function getCoachMessages(limit = 60): Promise<CoachMessage[]> {
  const sb = await createClient();
  const { data, error } = await sb
    .from("coach_messages")
    .select("id, user_id, role, content, intent, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    // De pagina blijft bruikbaar voordat de eenmalige chatmigratie is uitgevoerd.
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw error;
  }
  return ((data ?? []) as CoachMessage[]).reverse();
}

export async function getAthlete() {
  const sb = await createClient();
  const { data } = await sb
    .from("athlete_profile")
    .select("display_name, max_hr, resting_hr, lactate_threshold_hr, hr_zones, hr_zones_source")
    .limit(1)
    .maybeSingle();
  return data;
}

export async function getLastSync() {
  const sb = await createClient();
  const { data } = await sb
    .from("sync_log")
    .select("sync_type, finished_at, status, items_synced")
    .in("sync_type", ["manual", "recent", "backfill", "scheduled"])
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/** Laatste geslaagde netwerk-sync met Garmin. Interne feature-berekeningen
 *  tellen niet als een update van de brondata. */
export async function getLastGarminSync() {
  const sb = await createClient();
  const { data } = await sb
    .from("sync_log")
    .select("sync_type, finished_at, status, items_synced")
    .in("sync_type", ["manual", "recent", "backfill", "scheduled"])
    .eq("status", "ok")
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function getLatestVo2Max() {
  const sb = await createClient();
  const { data } = await sb
    .from("fitness_snapshots")
    .select("day, vo2max_running, race_predictions")
    .not("vo2max_running", "is", null)
    .order("day", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export type Vo2MaxSnapshot = {
  day: string;
  vo2max_running: number | null;
};

/** Garmin VO2max-metingen tot en met de gekozen dag. De reeks is bewust
 * oplopend gesorteerd zodat grafieken en "vorige meting" eenduidig zijn. */
export async function getVo2MaxWindow(endDay: string, days = 180) {
  const fromDate = new Date(`${endDay}T12:00:00Z`);
  fromDate.setUTCDate(fromDate.getUTCDate() - Math.max(days - 1, 0));
  const from = fromDate.toISOString().slice(0, 10);
  const sb = await createClient();
  const { data } = await sb
    .from("fitness_snapshots")
    .select("day, vo2max_running")
    .gte("day", from)
    .lte("day", endDay)
    .not("vo2max_running", "is", null)
    .order("day");
  return (data ?? []) as Vo2MaxSnapshot[];
}
