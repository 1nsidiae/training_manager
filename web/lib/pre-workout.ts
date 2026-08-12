import type {
  PlanSession,
  RecentTrainingFeedback,
  TrainingLoadSummary,
  Wellness,
} from "@/lib/queries";

export type PreWorkoutDecision = "go" | "lighten" | "move" | "recover";
export type PreWorkoutSignalTone = "good" | "neutral" | "watch" | "stop";

export type PreWorkoutSignal = {
  key: "readiness" | "sleep" | "hrv" | "resting_hr" | "load" | "feedback";
  label: string;
  value: string;
  detail: string;
  tone: PreWorkoutSignalTone;
};

export type PreWorkoutCheck = {
  decision: PreWorkoutDecision;
  title: string;
  summary: string;
  scheduledDay: string;
  dataDay: string | null;
  signals: PreWorkoutSignal[];
  negativeSignalCount: number;
};

type Input = {
  session: PlanSession;
  selectedDay: string;
  wellness: Wellness[];
  trainingLoad: TrainingLoadSummary;
  feedback: RecentTrainingFeedback[];
  rules: Record<string, Record<string, number>>;
};

function average(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function hours(seconds: number | null | undefined) {
  return seconds == null ? null : seconds / 3600;
}

function decimal(value: number, suffix = "") {
  return `${value.toLocaleString("nl-BE", { maximumFractionDigits: 1 })}${suffix}`;
}

function isNegative(tone: PreWorkoutSignalTone) {
  return tone === "watch" || tone === "stop";
}

function addDays(day: string, amount: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function buildPreWorkoutCheck({
  session,
  selectedDay,
  wellness,
  trainingLoad,
  feedback,
  rules,
}: Input): PreWorkoutCheck {
  const latest = wellness.find((item) => item.day === selectedDay) ?? null;
  const chronological = [...wellness]
    .filter((item) => item.day <= selectedDay)
    .sort((a, b) => a.day.localeCompare(b.day));
  const previous = chronological.filter((item) => item.day < selectedDay);
  const recentSeven = chronological.slice(-7);
  const sleepValues = recentSeven
    .map((item) => hours(item.sleep_total_s))
    .filter((value): value is number => value != null);
  const sleepAverage = average(sleepValues);
  const restingBaseline = average(
    previous
      .slice(-7)
      .map((item) => item.resting_hr)
      .filter((value): value is number => value != null),
  );

  const readinessThreshold = rules.readiness_gate_quality?.min_readiness ?? 50;
  const sleepThreshold = rules.sleep_7d_below_threshold?.threshold_h ?? 6;
  const painThreshold = rules.pain_score_override?.pain_threshold ?? 6;
  const readiness = latest?.training_readiness_score ?? null;
  const currentSleep = hours(latest?.sleep_total_s);
  const restingDelta =
    latest?.resting_hr != null && restingBaseline != null
      ? latest.resting_hr - restingBaseline
      : null;
  const hrvStatus = latest?.hrv_status?.toUpperCase() ?? null;

  const signals: PreWorkoutSignal[] = [];
  signals.push({
    key: "readiness",
    label: "Trainingsfitheid",
    value: readiness == null ? "Geen meting" : `${readiness} / 100`,
    detail:
      readiness == null
        ? "Garmin heeft voor deze dag nog geen trainingsfitheid aangeleverd."
        : readiness < 25
          ? "Onder 25 krijgt herstel voorrang."
          : readiness < readinessThreshold
            ? `Onder je kwaliteitsdrempel van ${readinessThreshold}.`
            : "Boven je ingestelde kwaliteitsdrempel.",
    tone:
      readiness == null
        ? "neutral"
        : readiness < 25
          ? "stop"
          : readiness < readinessThreshold
            ? "watch"
            : readiness >= 75
              ? "good"
              : "neutral",
  });

  signals.push({
    key: "sleep",
    label: "Slaapduur",
    value: currentSleep == null ? "Geen meting" : decimal(currentSleep, " u"),
    detail:
      sleepAverage == null
        ? "Nog geen bruikbaar 7-daags slaapgemiddelde."
        : `${decimal(sleepAverage, " u")} gemiddeld over ${sleepValues.length} nachten; grens ${decimal(sleepThreshold, " u")}.`,
    tone:
      currentSleep != null && currentSleep < 5
        ? "stop"
        : sleepAverage != null && sleepAverage < sleepThreshold
          ? "watch"
          : sleepAverage != null && sleepAverage >= 7
            ? "good"
            : "neutral",
  });

  signals.push({
    key: "hrv",
    label: "HRV-status",
    value: latest?.hrv_last_night_avg == null ? "Geen meting" : `${latest.hrv_last_night_avg} ms`,
    detail:
      hrvStatus == null
        ? "Garmin heeft voor deze dag nog geen HRV-status aangeleverd."
        : hrvStatus === "BALANCED"
          ? "Binnen je persoonlijke Garmin-baseline."
          : `Garmin-status: ${latest?.hrv_status?.toLowerCase().replaceAll("_", " ")}.`,
    tone:
      hrvStatus == null
        ? "neutral"
        : hrvStatus === "BALANCED"
          ? "good"
          : hrvStatus.includes("LOW") || hrvStatus.includes("UNBALANCED")
            ? "watch"
            : "neutral",
  });

  signals.push({
    key: "resting_hr",
    label: "Rusthartslag",
    value: latest?.resting_hr == null ? "Geen meting" : `${latest.resting_hr} bpm`,
    detail:
      restingDelta == null
        ? "Nog geen bruikbare vergelijking met de vorige zeven dagen."
        : `${restingDelta >= 0 ? "+" : ""}${Math.round(restingDelta)} bpm tegenover je recente gemiddelde.`,
    tone:
      restingDelta == null
        ? "neutral"
        : restingDelta >= 8
          ? "stop"
          : restingDelta >= 5
            ? "watch"
            : restingDelta <= -3
              ? "good"
              : "neutral",
  });

  const crossLoad = trainingLoad.sports
    .filter((item) => item.sport !== "running")
    .reduce((total, item) => total + item.load, 0);
  const loadHigh = trainingLoad.deltaPct != null && trainingLoad.deltaPct >= 25;
  const crossLoadHigh = crossLoad >= 40;
  signals.push({
    key: "load",
    label: "Trainingsbelasting",
    value: `${decimal(trainingLoad.currentLoad)} load`,
    detail: crossLoadHigh
      ? `${decimal(crossLoad)} load komt deze week uit andere sporten en telt mee voor herstel.`
      : trainingLoad.deltaPct == null
        ? "Nog geen vorige periode om betrouwbaar mee te vergelijken."
        : `${trainingLoad.deltaPct >= 0 ? "+" : ""}${trainingLoad.deltaPct}% tegenover de vorige zeven dagen.`,
    tone: loadHigh || crossLoadHigh ? "watch" : trainingLoad.currentLoad > 0 ? "neutral" : "good",
  });

  const feedbackFrom = addDays(selectedDay, -21);
  const recentFeedback = feedback
    .filter((item) => {
      const feedbackDay = item.session?.day ?? item.created_at.slice(0, 10);
      return feedbackDay >= feedbackFrom && feedbackDay <= selectedDay;
    })
    .slice(0, 3);
  const maxPain = recentFeedback.length
    ? Math.max(...recentFeedback.map((item) => item.pain_score))
    : null;
  const hardSessions = recentFeedback.filter((item) => {
    const compliance = item.session?.targets?.compliance?.status;
    const rpe = Number(item.extra?.rpe ?? 0);
    return compliance === "missed" || rpe >= 8 || item.endurance_score <= 2;
  }).length;
  if (recentFeedback.length) {
    signals.push({
      key: "feedback",
      label: "Jouw feedback",
      value: maxPain != null && maxPain > 0 ? `Pijn ${maxPain} / 10` : `${hardSessions} zware signalen`,
      detail:
        maxPain != null && maxPain >= painThreshold
          ? `Je pijngrens van ${painThreshold} is geraakt; die overrulet het trainingsdoel.`
          : hardSessions >= 2
            ? "Minstens twee recente sessies misten hun doel of voelden uitzonderlijk zwaar."
            : "Geen herhaald patroon dat om een automatische verzwaring vraagt.",
      tone:
        maxPain != null && maxPain >= painThreshold
          ? "stop"
          : hardSessions >= 2
            ? "watch"
            : "good",
    });
  }

  const negative = signals.filter((signal) => isNegative(signal.tone));
  const criticalPain = maxPain != null && maxPain >= painThreshold;
  const criticalReadiness = readiness != null && readiness < 25;
  const criticalRestingHr = restingDelta != null && restingDelta >= 8;
  const repeatedDifficulty = hardSessions >= 2;
  const quality = ["tempo", "interval", "race"].includes(session.session_type);
  const demanding = quality || session.session_type === "long";

  let decision: PreWorkoutDecision = "go";
  if (criticalPain || criticalReadiness || (criticalRestingHr && negative.length >= 2)) {
    decision = "recover";
  } else if (demanding && negative.length >= 3) {
    decision = "move";
  } else if ((quality && negative.length >= 1) || repeatedDifficulty || negative.length >= 2) {
    decision = "lighten";
  }

  const copy: Record<PreWorkoutDecision, { title: string; summary: string }> = {
    go: {
      title: latest ? "Uitvoeren volgens plan" : "Uitvoeren met eigen check",
      summary: latest
        ? `De beschikbare signalen geven geen reden om ${session.title.toLowerCase()} aan te passen.`
        : "Er is nog geen Garmin-meting voor deze dag. De beschikbare trainingsdata geeft geen reden om aan te passen; laat je eigen gevoel beslissen.",
    },
    lighten: {
      title: "Vandaag lichter trainen",
      summary: "Je kunt bewegen, maar de geplande belasting past vandaag minder goed bij je herstel.",
    },
    move: {
      title: "Training verplaatsen",
      summary: "Meerdere herstelsignalen maken deze belastende sessie vandaag een ongunstige combinatie.",
    },
    recover: {
      title: "Maak er een hersteldag van",
      summary: "Een veiligheidsgrens is geraakt. Herstel krijgt vandaag voorrang op het trainingsdoel.",
    },
  };

  return {
    decision,
    ...copy[decision],
    scheduledDay: session.day,
    dataDay: latest?.day ?? null,
    signals,
    negativeSignalCount: negative.length,
  };
}
