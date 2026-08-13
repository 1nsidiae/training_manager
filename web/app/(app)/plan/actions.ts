"use server";

import { createClient } from "@/lib/supabase/server";

const GOAL_TYPES = ["race", "time_target", "maintenance", "return_to_run"] as const;
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

type GoalType = (typeof GOAL_TYPES)[number];
type Weekday = (typeof WEEKDAYS)[number];

export type NewPlanRequest = {
  goalType: GoalType;
  targetDistanceM: number | null;
  targetDate: string | null;
  targetTimeS: number | null;
  planStartDate: string;
  firstTrainingDate: string;
  currentCapacityM: number;
  currentWeeklyVolumeM: number;
  benchmarkDistanceM: number | null;
  benchmarkTimeS: number | null;
  sessionsPerWeek: number;
  trainingDays: Weekday[];
  longRunDay: Weekday | null;
  maxWeekdayMinutes: number;
  maxWeekendMinutes: number;
  ambition: "conservative" | "balanced" | "ambitious";
  limitations: string;
};

export type NewPlanResult = {
  ok: boolean;
  error: string | null;
  requestId: number | null;
  goalId: number | null;
};

function finiteBetween(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function validIsoDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function distanceLabel(distanceM: number | null) {
  if (!distanceM) return "lopen";
  if (Math.abs(distanceM - 5_000) < 1) return "5 km";
  if (Math.abs(distanceM - 10_000) < 1) return "10 km";
  if (Math.abs(distanceM - 21_097.5) < 2) return "halve marathon";
  if (Math.abs(distanceM - 42_195) < 2) return "marathon";
  return `${(distanceM / 1000).toLocaleString("nl-BE", { maximumFractionDigits: 1 })} km`;
}

function timeLabel(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function goalName(input: NewPlanRequest) {
  const distance = distanceLabel(input.targetDistanceM);
  if (input.goalType === "time_target" && input.targetTimeS) {
    return `${distance} onder ${timeLabel(input.targetTimeS)}`;
  }
  if (input.goalType === "race") {
    return input.targetTimeS
      ? `${distance} in ${timeLabel(input.targetTimeS)}`
      : `${distance} wedstrijd`;
  }
  if (input.goalType === "return_to_run") return "Veilig terug naar lopen";
  return "Loopconditie en basis opbouwen";
}

function validate(input: NewPlanRequest): string | null {
  if (!GOAL_TYPES.includes(input.goalType)) return "Kies eerst wat je wilt bereiken.";

  const needsDistance = input.goalType === "race" || input.goalType === "time_target";
  if (needsDistance && !finiteBetween(input.targetDistanceM, 1_000, 200_000)) {
    return "Kies een geldige doelafstand.";
  }
  if (input.goalType === "race" && !validIsoDate(input.targetDate)) {
    return "Kies de datum van je wedstrijd.";
  }
  if (input.targetDate && !validIsoDate(input.targetDate)) return "De doeldatum is ongeldig.";
  if (input.targetDate) {
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (new Date(`${input.targetDate}T12:00:00`) < tomorrow) return "Je doeldatum moet in de toekomst liggen.";
  }
  if (input.goalType === "time_target" && !finiteBetween(input.targetTimeS, 60, 259_200)) {
    return "Vul de tijd in die je wilt halen.";
  }
  if (input.targetTimeS != null && !finiteBetween(input.targetTimeS, 60, 259_200)) {
    return "De gewenste eindtijd is ongeldig.";
  }
  if (!validIsoDate(input.planStartDate) || !validIsoDate(input.firstTrainingDate)) {
    return "Kies een geldige planstart en eerste trainingsdag.";
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (new Date(`${input.planStartDate}T12:00:00`) < today) {
    return "De start van je nieuwe plan kan niet in het verleden liggen.";
  }
  if (input.firstTrainingDate < input.planStartDate) {
    return "Je eerste training kan niet vóór de start van je plan vallen.";
  }
  if (input.targetDate && input.firstTrainingDate >= input.targetDate) {
    return "Je eerste training moet vóór je doeldatum vallen.";
  }
  if (!finiteBetween(input.currentCapacityM, 0, 200_000)) return "Vul je huidige loopcapaciteit in.";
  if (!finiteBetween(input.currentWeeklyVolumeM, 0, 400_000)) return "Vul een geldig huidig weekvolume in.";
  if (input.benchmarkDistanceM != null && !finiteBetween(input.benchmarkDistanceM, 500, 200_000)) {
    return "De afstand van je recente test is ongeldig.";
  }
  if (input.benchmarkTimeS != null && !finiteBetween(input.benchmarkTimeS, 60, 259_200)) {
    return "De tijd van je recente test is ongeldig.";
  }
  if ((input.benchmarkDistanceM == null) !== (input.benchmarkTimeS == null)) {
    return "Vul voor je recente prestatie zowel afstand als tijd in, of laat beide leeg.";
  }
  if (!Number.isInteger(input.sessionsPerWeek) || input.sessionsPerWeek < 2 || input.sessionsPerWeek > 6) {
    return "Kies tussen twee en zes trainingen per week.";
  }
  if (new Set(input.trainingDays).size !== input.trainingDays.length || input.trainingDays.some((day) => !WEEKDAYS.includes(day))) {
    return "De gekozen trainingsdagen zijn ongeldig.";
  }
  if (input.trainingDays.length < input.sessionsPerWeek) {
    return "Kies minstens evenveel beschikbare dagen als trainingen per week.";
  }
  const firstTrainingWeekday = WEEKDAYS[(new Date(`${input.firstTrainingDate}T12:00:00Z`).getUTCDay() + 6) % 7];
  if (!input.trainingDays.includes(firstTrainingWeekday)) {
    return "Je eerste trainingsdag moet ook bij je beschikbare dagen staan.";
  }
  if (input.longRunDay && (!WEEKDAYS.includes(input.longRunDay) || !input.trainingDays.includes(input.longRunDay))) {
    return "Kies een beschikbare dag voor je lange duurloop.";
  }
  if (!finiteBetween(input.maxWeekdayMinutes, 20, 300) || !finiteBetween(input.maxWeekendMinutes, 20, 480)) {
    return "De beschikbare trainingstijd is ongeldig.";
  }
  if (!["conservative", "balanced", "ambitious"].includes(input.ambition)) return "Kies hoe ambitieus het plan mag zijn.";
  if (input.limitations.length > 700) return "Hou beperkingen en opmerkingen onder 700 tekens.";
  return null;
}

export async function requestNewPlan(input: NewPlanRequest): Promise<NewPlanResult> {
  const validationError = validate(input);
  if (validationError) return { ok: false, error: validationError, requestId: null, goalId: null };

  const sb = await createClient();
  const { data: auth, error: authError } = await sb.auth.getUser();
  if (authError || !auth.user) {
    return { ok: false, error: "Je sessie is verlopen. Log opnieuw in.", requestId: null, goalId: null };
  }

  const [{ data: activePlan }, { data: existingProposal }] = await Promise.all([
    sb.from("plans").select("id").eq("status", "active").limit(1).maybeSingle(),
    sb.from("plans").select("id").eq("status", "proposed").limit(1).maybeSingle(),
  ]);
  if (existingProposal) {
    return {
      ok: false,
      error: "Er wacht al een planvoorstel op je keuze. Beoordeel dat eerst.",
      requestId: null,
      goalId: null,
    };
  }

  const { data: activeRequest } = await sb
    .from("sync_log")
    .select("id, sync_type")
    .in("status", ["requested", "running"])
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeRequest) {
    return {
      ok: false,
      error: "Er loopt al een andere Garmin- of coachtaak. Probeer opnieuw zodra die klaar is.",
      requestId: null,
      goalId: null,
    };
  }

  const params = {
    plan_request_version: 2,
    created_via: "plan_wizard",
    plan_start_date: input.planStartDate,
    first_training_date: input.firstTrainingDate,
    current_capacity_m: Math.round(input.currentCapacityM),
    continuous_running: input.currentCapacityM >= 1_000,
    current_weekly_volume_m: Math.round(input.currentWeeklyVolumeM),
    benchmark_distance_m: input.benchmarkDistanceM == null ? null : Math.round(input.benchmarkDistanceM),
    benchmark_time_s: input.benchmarkTimeS == null ? null : Math.round(input.benchmarkTimeS),
    sessions_per_week: input.sessionsPerWeek,
    preferred_training_days: input.trainingDays,
    preferred_long_run_day: input.longRunDay,
    max_weekday_duration_min: Math.round(input.maxWeekdayMinutes),
    max_weekend_duration_min: Math.round(input.maxWeekendMinutes),
    ambition: input.ambition,
    limitations: input.limitations.trim() || null,
  };

  // Bij een bestaand schema blijft het nieuwe doel bewust gearchiveerd tot de
  // atleet het bijbehorende planvoorstel goedkeurt. Zo blijft afwijzen veilig.
  const { data: goal, error: goalError } = await sb
    .from("goals")
    .insert({
      goal_type: input.goalType,
      name: goalName(input),
      status: activePlan ? "archived" : "active",
      target_date: input.targetDate,
      target_distance_m: input.targetDistanceM,
      target_time_s: input.targetTimeS,
      params,
    })
    .select("id")
    .single();
  if (goalError || !goal) {
    return { ok: false, error: "Je trainingsdoel kon niet veilig worden opgeslagen.", requestId: null, goalId: null };
  }

  const { data: request, error: requestError } = await sb
    .from("sync_log")
    .insert({ sync_type: `goal_plan_review:${goal.id}`, status: "requested" })
    .select("id")
    .single();
  if (requestError || !request) {
    return {
      ok: false,
      error: requestError?.code === "23505"
        ? "Er loopt al een andere Garmin- of coachtaak. Probeer opnieuw zodra die klaar is."
        : "De coachtaak kon niet worden gestart.",
      requestId: null,
      goalId: goal.id,
    };
  }

  return { ok: true, error: null, requestId: request.id, goalId: goal.id };
}
