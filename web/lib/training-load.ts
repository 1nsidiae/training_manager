import modelJson from "../../tm_sync/training_load_model.json";

type SportProfile = {
  load_per_minute: number;
  aerobic_factor: number;
  mechanical_factor: number;
};

const MODEL = modelJson as {
  version: number;
  minimum_chronic_load: number;
  zone_weights: number[];
  sports: Record<string, SportProfile>;
};

const SPORT_ALIASES: Record<string, string[]> = {
  running: ["run", "jog", "trail", "treadmill"],
  cycling: ["cycl", "bike", "biking", "bmx", "mountain_bik"],
  swimming: ["swim"],
  walking: ["walk"],
  hiking: ["hik", "trek"],
  strength: ["strength", "weight", "gym", "resistance", "functional"],
  racquet: ["padel", "tennis", "squash", "badminton", "pickleball", "racquet"],
  team_sport: ["football", "soccer", "basketball", "volleyball", "hockey", "rugby"],
  rowing: ["row", "kayak", "canoe", "paddle"],
  winter_sport: ["ski", "snowboard", "skate"],
  yoga: ["yoga", "pilates", "mobility", "breathwork"],
};

const SPORT_LABELS: Record<string, string> = {
  running: "Hardlopen", cycling: "Fietsen", swimming: "Zwemmen",
  walking: "Wandelen", hiking: "Hiken", strength: "Kracht",
  racquet: "Racketsport", team_sport: "Teamsport", rowing: "Roeien & peddelen",
  winter_sport: "Wintersport", yoga: "Yoga & mobiliteit", other: "Overige sport",
};

export function trainingLoadSportLabel(sport: string) {
  return SPORT_LABELS[sport] ?? sport.replaceAll("_", " ");
}

export type LoadSource = "garmin" | "heart_rate" | "duration" | "missing";
export type LoadDataQuality = "measured" | "mixed" | "estimated" | "missing";
export type HeavyRunImpact = "clear" | "watch" | "protect";

export type LoadActivityRow = {
  id: number;
  sport: string;
  sub_sport: string | null;
  name: string | null;
  start_time_local: string;
  duration_s: number | null;
  raw: { activityTrainingLoad?: number | string | null } | null;
};

export type TrainingLoadDay = {
  day: string;
  load: number;
  aerobicLoad: number;
  mechanicalLoad: number;
};

export type TrainingLoadSport = {
  sport: string;
  load: number;
  aerobicLoad: number;
  mechanicalLoad: number;
  duration_s: number;
  sessions: number;
  estimatedSessions: number;
};

export type TrainingLoadSource = {
  id: number;
  sport: string;
  sub_sport: string | null;
  name: string | null;
  start_time_local: string;
  duration_s: number;
  load: number | null;
  loadSource?: LoadSource;
};

export type TrainingLoadSummary = {
  currentLoad: number;
  previousLoad: number;
  chronicLoad: number;
  acwr: number | null;
  monotony: number | null;
  strain: number | null;
  deltaPct: number | null;
  currentDurationS: number;
  days: TrainingLoadDay[];
  sports: TrainingLoadSport[];
  lastActivity: TrainingLoadSource | null;
  recentCrossLoad: {
    load: number;
    aerobicLoad: number;
    mechanicalLoad: number;
  };
  heavyRunImpact: HeavyRunImpact;
  dataQuality: LoadDataQuality;
  sources: Record<LoadSource, number>;
};

export function canonicalSport(sport?: string | null, subSport?: string | null, name?: string | null) {
  const haystack = [sport, subSport, name]
    .map((value) => String(value ?? "").toLowerCase().replaceAll(" ", "_"))
    .join("_");
  const order = [
    "hiking", "running", "cycling", "swimming", "walking", "strength",
    "racquet", "team_sport", "rowing", "winter_sport", "yoga",
  ];
  return order.find((key) => SPORT_ALIASES[key].some((alias) => haystack.includes(alias))) ?? "other";
}

function rounded(value: number) {
  return Math.round(value * 10) / 10;
}

export function estimateActivityLoad(row: LoadActivityRow, zones: number[] = []) {
  const sport = canonicalSport(row.sport, row.sub_sport, row.name);
  const profile = MODEL.sports[sport] ?? MODEL.sports.other;
  const garminLoad = Number(row.raw?.activityTrainingLoad ?? 0);
  const zoneLoad = zones.reduce(
    (total, seconds, index) => total + (Number(seconds) / 60) * (MODEL.zone_weights[index] ?? index + 1),
    0,
  );
  const durationLoad = (Number(row.duration_s) || 0) / 60 * profile.load_per_minute;
  let load = 0;
  let source: LoadSource = "missing";
  if (Number.isFinite(garminLoad) && garminLoad > 0) {
    load = garminLoad;
    source = "garmin";
  } else if (zoneLoad > 0) {
    load = zoneLoad;
    source = "heart_rate";
  } else if (durationLoad > 0) {
    load = durationLoad;
    source = "duration";
  }
  return {
    sport,
    load: rounded(load),
    aerobicLoad: rounded(load * profile.aerobic_factor),
    mechanicalLoad: rounded(load * profile.mechanical_factor),
    source,
    estimated: source === "duration",
  };
}

function addDays(day: string, amount: number) {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function pstdev(values: number[]) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

export function buildTrainingLoadSummary(
  rows: LoadActivityRow[],
  zones: Map<number, number[]>,
  endDay: string,
): TrainingLoadSummary {
  const fromDay = addDays(endDay, -27);
  const currentStart = addDays(endDay, -6);
  const recentStart = addDays(endDay, -1);
  const days = Array.from({ length: 28 }, (_, index): TrainingLoadDay => ({
    day: addDays(fromDay, index), load: 0, aerobicLoad: 0, mechanicalLoad: 0,
  }));
  const dayMap = new Map(days.map((day) => [day.day, day]));
  const sportMap = new Map<string, TrainingLoadSport>();
  const sources: Record<LoadSource, number> = { garmin: 0, heart_rate: 0, duration: 0, missing: 0 };
  const recentCrossLoad = { load: 0, aerobicLoad: 0, mechanicalLoad: 0 };
  let currentDurationS = 0;

  for (const row of rows) {
    const day = row.start_time_local.slice(0, 10);
    const estimate = estimateActivityLoad(row, zones.get(row.id));
    const point = dayMap.get(day);
    if (!point) continue;
    point.load += estimate.load;
    point.aerobicLoad += estimate.aerobicLoad;
    point.mechanicalLoad += estimate.mechanicalLoad;
    sources[estimate.source] += 1;

    if (day >= currentStart && day <= endDay) {
      const slot = sportMap.get(estimate.sport) ?? {
        sport: estimate.sport, load: 0, aerobicLoad: 0, mechanicalLoad: 0,
        duration_s: 0, sessions: 0, estimatedSessions: 0,
      };
      slot.load += estimate.load;
      slot.aerobicLoad += estimate.aerobicLoad;
      slot.mechanicalLoad += estimate.mechanicalLoad;
      slot.duration_s += Number(row.duration_s) || 0;
      slot.sessions += 1;
      slot.estimatedSessions += Number(estimate.estimated);
      currentDurationS += Number(row.duration_s) || 0;
      sportMap.set(estimate.sport, slot);
    }
    if (day >= recentStart && estimate.sport !== "running") {
      recentCrossLoad.load += estimate.load;
      recentCrossLoad.aerobicLoad += estimate.aerobicLoad;
      recentCrossLoad.mechanicalLoad += estimate.mechanicalLoad;
    }
  }

  days.forEach((day) => {
    day.load = rounded(day.load);
    day.aerobicLoad = rounded(day.aerobicLoad);
    day.mechanicalLoad = rounded(day.mechanicalLoad);
  });
  const currentLoad = days.slice(-7).reduce((sum, day) => sum + day.load, 0);
  const previousLoad = days.slice(-14, -7).reduce((sum, day) => sum + day.load, 0);
  const chronicLoad = days.reduce((sum, day) => sum + day.load, 0) / 4;
  const acwr = chronicLoad >= MODEL.minimum_chronic_load ? currentLoad / chronicLoad : null;
  const currentDaily = days.slice(-7).map((day) => day.load);
  const spread = pstdev(currentDaily);
  const monotony = spread > 0 && currentLoad > 0 ? currentLoad / 7 / spread : null;
  const baselineDay = Math.max(chronicLoad / 7, 20);
  const heavyRunImpact: HeavyRunImpact =
    recentCrossLoad.load >= baselineDay * 2 || recentCrossLoad.mechanicalLoad >= baselineDay
      ? "protect"
      : recentCrossLoad.load >= baselineDay || recentCrossLoad.mechanicalLoad >= baselineDay * 0.5
        ? "watch"
        : "clear";
  const measured = sources.garmin + sources.heart_rate;
  const usable = measured + sources.duration;
  const dataQuality: LoadDataQuality =
    usable === 0 ? "missing"
      : sources.duration === 0 ? "measured"
        : measured > 0 ? "mixed" : "estimated";
  const latest = rows.find((row) => row.start_time_local.slice(0, 10) >= currentStart) ?? null;
  const latestEstimate = latest ? estimateActivityLoad(latest, zones.get(latest.id)) : null;

  return {
    currentLoad: rounded(currentLoad),
    previousLoad: rounded(previousLoad),
    chronicLoad: rounded(chronicLoad),
    acwr: acwr == null ? null : Math.round(acwr * 100) / 100,
    monotony: monotony == null ? null : Math.round(monotony * 100) / 100,
    strain: monotony == null ? null : rounded(currentLoad * monotony),
    deltaPct: previousLoad > 0 ? Math.round(((currentLoad - previousLoad) / previousLoad) * 100) : null,
    currentDurationS: Math.round(currentDurationS),
    days,
    sports: [...sportMap.values()].map((sport) => ({
      ...sport,
      load: rounded(sport.load),
      aerobicLoad: rounded(sport.aerobicLoad),
      mechanicalLoad: rounded(sport.mechanicalLoad),
      duration_s: Math.round(sport.duration_s),
    })).sort((a, b) => b.load - a.load),
    lastActivity: latest && latestEstimate ? {
      id: latest.id, sport: latest.sport, sub_sport: latest.sub_sport, name: latest.name,
      start_time_local: latest.start_time_local, duration_s: Math.round(Number(latest.duration_s) || 0),
      load: latestEstimate.load, loadSource: latestEstimate.source,
    } : null,
    recentCrossLoad: {
      load: rounded(recentCrossLoad.load),
      aerobicLoad: rounded(recentCrossLoad.aerobicLoad),
      mechanicalLoad: rounded(recentCrossLoad.mechanicalLoad),
    },
    heavyRunImpact,
    dataQuality,
    sources,
  };
}
