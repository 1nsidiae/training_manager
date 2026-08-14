import type {
  Activity,
  PlanSession,
  RecentTrainingFeedback,
  TrainingLoadSummary,
  Wellness,
} from "@/lib/queries";

export type WeeklyReviewTone = "recovery" | "warning" | "danger" | "info";

export type WeeklyReview = {
  fromDay: string;
  throughDay: string;
  weekEnd: string;
  isFinal: boolean;
  outcome: "building" | "on_track" | "hold" | "recover" | "insufficient";
  tone: WeeklyReviewTone;
  eyebrow: string;
  title: string;
  summary: string;
  decision: string;
  evidence: string[];
  dueSessions: number;
  completedSessions: number;
  plannedSessions: number;
  adherencePct: number | null;
  plannedRunDistanceM: number;
  actualRunDistanceM: number;
  otherActivities: number;
  otherActivityDurationS: number;
  feedbackCount: number;
  avgRpe: number | null;
  maxPain: number | null;
  avgEndurance: number | null;
  wellnessDays: number;
  avgSleepS: number | null;
  avgReadiness: number | null;
  hrvUnbalancedDays: number;
  acuteLoad: number;
  chronicLoad: number;
  acwr: number | null;
  crossTrainingLoad: number;
  loadDataQuality: TrainingLoadSummary["dataQuality"];
  heavyRunImpact: TrainingLoadSummary["heavyRunImpact"];
  loadSports: TrainingLoadSummary["sports"];
};

type WeeklyReviewInput = {
  fromDay: string;
  throughDay: string;
  weekEnd: string;
  sessions: PlanSession[];
  activities: Activity[];
  feedback: RecentTrainingFeedback[];
  wellness: Wellness[];
  trainingLoad: TrainingLoadSummary;
  sleepThresholdHours?: number;
  readinessThreshold?: number;
};

const ACTIVE_SESSION_STATUSES = new Set(["planned", "moved", "completed", "skipped"]);

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function formatHours(seconds: number) {
  return `${(seconds / 3600).toFixed(1).replace(".", ",")} u`;
}

function formatKm(meters: number) {
  return `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
}

function inRange(day: string, fromDay: string, throughDay: string) {
  return day >= fromDay && day <= throughDay;
}

/** Bouwt de weekreview uit meetbare signalen. Dit is bewust geen verborgen
 * totaalscore: de atleet ziet uitvoering, gevoel en herstel afzonderlijk. */
export function buildWeeklyReview({
  fromDay,
  throughDay,
  weekEnd,
  sessions,
  activities,
  feedback,
  wellness,
  trainingLoad,
  sleepThresholdHours = 6,
  readinessThreshold = 50,
}: WeeklyReviewInput): WeeklyReview {
  const isFinal = throughDay >= weekEnd;
  const weekSessions = sessions.filter(
    (session) =>
      inRange(session.day, fromDay, weekEnd) &&
      session.session_type !== "rest" &&
      ACTIVE_SESSION_STATUSES.has(session.status),
  );
  const dueSessions = weekSessions.filter((session) => session.day <= throughDay);
  const completedSessions = dueSessions.filter((session) => session.status === "completed");
  const adherencePct = dueSessions.length
    ? Math.round((completedSessions.length / dueSessions.length) * 100)
    : null;

  const plannedRunDistanceM = weekSessions
    .filter((session) => session.sport === "running")
    .reduce((sum, session) => sum + (session.planned_distance_m ?? 0), 0);
  const periodActivities = activities.filter((activity) =>
    inRange(activity.start_time_local.slice(0, 10), fromDay, throughDay),
  );
  const actualRunDistanceM = periodActivities
    .filter((activity) => activity.sport === "running")
    .reduce((sum, activity) => sum + (activity.distance_m ?? 0), 0);
  const otherSports = periodActivities.filter((activity) => activity.sport !== "running");
  const otherActivityDurationS = otherSports.reduce(
    (sum, activity) => sum + (activity.duration_s ?? 0),
    0,
  );

  const weekFeedback = feedback.filter(
    (item) => item.session && inRange(item.session.day, fromDay, throughDay),
  );
  const rpeValues = weekFeedback
    .map((item) => item.extra?.rpe)
    .filter((value): value is number => value != null);
  const painValues = weekFeedback
    .map((item) => item.pain_score)
    .filter((value): value is number => value != null);
  const enduranceValues = weekFeedback
    .map((item) => item.endurance_score)
    .filter((value): value is number => value != null);
  const avgRpe = average(rpeValues);
  const maxPain = painValues.length ? Math.max(...painValues) : null;
  const avgEndurance = average(enduranceValues);

  const weekWellness = wellness.filter((item) => inRange(item.day, fromDay, throughDay));
  const sleepValues = weekWellness
    .map((item) => item.sleep_total_s)
    .filter((value): value is number => value != null);
  const readinessValues = weekWellness
    .map((item) => item.training_readiness_score)
    .filter((value): value is number => value != null);
  const avgSleepS = average(sleepValues);
  const avgReadiness = average(readinessValues);
  const hrvUnbalancedDays = weekWellness.filter((item) =>
    ["UNBALANCED", "LOW", "POOR"].includes(String(item.hrv_status ?? "").toUpperCase()),
  ).length;
  const lowSleep = avgSleepS != null && avgSleepS < sleepThresholdHours * 3600;
  const lowReadiness = avgReadiness != null && avgReadiness < readinessThreshold;
  const painAlarm = maxPain != null && maxPain >= 6;
  const heavyPattern = avgRpe != null && avgRpe >= 8;
  const crossTrainingLoad = trainingLoad.sports
    .filter((sport) => sport.sport !== "running")
    .reduce((sum, sport) => sum + sport.load, 0);
  const loadSpike = trainingLoad.acwr != null && trainingLoad.acwr >= 1.5;
  const recoveryLoadConflict =
    trainingLoad.heavyRunImpact === "protect" && (lowReadiness || lowSleep || heavyPattern);

  const missedPattern = dueSessions.length >= 2 && adherencePct != null && adherencePct < 60;
  const recoveryPattern =
    painAlarm ||
    recoveryLoadConflict ||
    (hrvUnbalancedDays >= 3 && lowReadiness) ||
    (lowSleep && lowReadiness) ||
    (heavyPattern && (maxPain ?? 0) >= 3);
  const limitedData = dueSessions.length === 0 && periodActivities.length === 0;

  let outcome: WeeklyReview["outcome"] = "building";
  let tone: WeeklyReviewTone = "info";
  let title = "Review wordt opgebouwd";
  let summary = "Je uitvoering, herstel en feedback worden deze week samen gevolgd.";
  let decision = "De definitieve weekreview volgt na de laatste trainingsdag.";

  if (limitedData) {
    outcome = "insufficient";
    title = "Nog te weinig weekdata";
    summary = "Er is in deze periode nog geen training of uitvoering om betrouwbaar te beoordelen.";
    decision = isFinal
      ? "De coach behoudt het huidige plan tot er voldoende trainingsdata is."
      : "De review vult zich automatisch zodra je eerste training is uitgevoerd.";
  } else if (recoveryPattern) {
    outcome = "recover";
    tone = "danger";
    title = "Herstel vraagt aandacht";
    summary = painAlarm
      ? `Je meldde een pijnscore van ${maxPain}/10. Dat gaat voor op trainingsprogressie.`
      : "Meerdere herstelsignalen wijzen dezelfde kant op; extra belasting is nu niet verstandig.";
    decision = isFinal
      ? "Niet opbouwen. De coach beoordeelt of de komende week lichter moet."
      : "De coach bewaakt de resterende trainingen en stelt alleen met jouw akkoord een wijziging voor.";
  } else if (missedPattern || heavyPattern || loadSpike || trainingLoad.heavyRunImpact === "protect") {
    outcome = "hold";
    tone = "warning";
    title = "Belasting nog vasthouden";
    summary = missedPattern
      ? `${completedSessions.length} van ${dueSessions.length} geplande trainingen zijn uitgevoerd.`
      : trainingLoad.heavyRunImpact === "protect"
        ? "Recente belasting uit alle sporten vraagt ruimte vóór de volgende zware loopprikkel."
        : loadSpike
          ? "Je acute belasting ligt duidelijk boven je gebruikelijke 28-daagse niveau."
      : `Je gemiddelde ervaren inspanning is ${avgRpe?.toFixed(1).replace(".", ",")}/10.`;
    decision = isFinal
      ? "Nog niet opbouwen; eerst moet de huidige weekbelasting haalbaar voelen."
      : "De resterende week blijft ongewijzigd, tenzij nieuwe feedback om herstel vraagt.";
  } else if (
    isFinal &&
    adherencePct != null &&
    adherencePct >= 85 &&
    (avgRpe == null || avgRpe <= 6.5) &&
    (maxPain == null || maxPain < 3) &&
    !lowReadiness
  ) {
    outcome = "on_track";
    tone = "recovery";
    title = "Klaar voor de volgende stap";
    summary = "De geplande week is goed uitgevoerd zonder duidelijk herstel- of pijnsignaal.";
    decision = "De coach mag binnen je vaste veiligheidsregels een volgende opbouwstap voorstellen.";
  } else if (isFinal) {
    outcome = "hold";
    tone = "warning";
    title = "Plan behouden";
    summary = "De week geeft geen sterk signaal om sneller op te bouwen of terug te schakelen.";
    decision = "De komende week blijft binnen de huidige opbouwlijn.";
  }

  const evidence: string[] = [];
  if (dueSessions.length) {
    evidence.push(`${completedSessions.length} van ${dueSessions.length} verschuldigde sessies afgerond`);
  }
  if (plannedRunDistanceM || actualRunDistanceM) {
    evidence.push(`${formatKm(actualRunDistanceM)} gelopen van ${formatKm(plannedRunDistanceM)} gepland`);
  }
  if (weekFeedback.length) {
    evidence.push(
      `${weekFeedback.length} ${weekFeedback.length === 1 ? "feedbackmoment" : "feedbackmomenten"}` +
        (avgRpe == null ? "" : ` · RPE ${avgRpe.toFixed(1).replace(".", ",")}/10`),
    );
  }
  if (avgSleepS != null) evidence.push(`gemiddeld ${formatHours(avgSleepS)} slaap`);
  if (avgReadiness != null) evidence.push(`gemiddelde Trainingsfitheid ${Math.round(avgReadiness)}`);
  if (otherSports.length) {
    evidence.push(
      `${otherSports.length} ${otherSports.length === 1 ? "andere activiteit" : "andere activiteiten"} · ${formatHours(otherActivityDurationS)}`,
    );
  }
  if (trainingLoad.currentLoad > 0) {
    evidence.push(
      `${trainingLoad.currentLoad.toFixed(0)} belasting in 7 dagen` +
        (crossTrainingLoad > 0 ? ` · ${crossTrainingLoad.toFixed(0)} uit andere sporten` : ""),
    );
  }

  return {
    fromDay,
    throughDay,
    weekEnd,
    isFinal,
    outcome,
    tone,
    eyebrow: isFinal ? "Afgeronde week" : "Lopende week",
    title,
    summary,
    decision,
    evidence,
    dueSessions: dueSessions.length,
    completedSessions: completedSessions.length,
    plannedSessions: weekSessions.length,
    adherencePct,
    plannedRunDistanceM,
    actualRunDistanceM,
    otherActivities: otherSports.length,
    otherActivityDurationS,
    feedbackCount: weekFeedback.length,
    avgRpe,
    maxPain,
    avgEndurance,
    wellnessDays: weekWellness.length,
    avgSleepS,
    avgReadiness,
    hrvUnbalancedDays,
    acuteLoad: trainingLoad.currentLoad,
    chronicLoad: trainingLoad.chronicLoad,
    acwr: trainingLoad.acwr,
    crossTrainingLoad,
    loadDataQuality: trainingLoad.dataQuality,
    heavyRunImpact: trainingLoad.heavyRunImpact,
    loadSports: trainingLoad.sports,
  };
}
