import type { PlanSession } from "@/lib/queries";

export type PlanChange = {
  key: string;
  label: string;
  before: string;
  after: string;
};

const TYPE_LABEL: Record<string, string> = {
  recovery: "Herstelloop",
  easy: "Rustige duurloop",
  long: "Lange duurloop",
  tempo: "Tempoloop",
  interval: "Intervaltraining",
  walk_run: "Wandel-loop",
  race: "Wedstrijd",
  strength: "Krachttraining",
  cross_training: "Cross-training",
};

function active(sessions: PlanSession[]) {
  return [...sessions]
    .filter((session) => session.session_type !== "rest")
    .sort((a, b) => a.day.localeCompare(b.day) || a.id - b.id);
}

function runVolume(sessions: PlanSession[]) {
  return sessions.reduce(
    (sum, session) =>
      sum + (session.sport === "running" ? session.planned_distance_m ?? 0 : 0),
    0,
  );
}

function distance(value: number | null) {
  return value == null
    ? null
    : `${(value / 1000).toLocaleString("nl-BE", { maximumFractionDigits: 1 })} km`;
}

function duration(value: number | null) {
  if (value == null) return null;
  const minutes = Math.round(value / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}u ${String(minutes % 60).padStart(2, "0")}`
    : `${minutes} min`;
}

function compactDay(day: string) {
  return new Intl.DateTimeFormat("nl-BE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(new Date(`${day}T12:00:00`))
    .replaceAll(".", "");
}

function sessionSummary(session: PlanSession) {
  const type = TYPE_LABEL[session.session_type] ?? session.title;
  const amount = distance(session.planned_distance_m) ?? duration(session.planned_duration_s);
  return [type, amount, compactDay(session.day)].filter(Boolean).join(" · ");
}

function weekNumber(day: string, firstDay: string) {
  const start = new Date(`${firstDay}T12:00:00Z`);
  const value = new Date(`${day}T12:00:00Z`);
  return Math.max(1, Math.floor((value.getTime() - start.getTime()) / 604_800_000) + 1);
}

type SessionPair = { older?: PlanSession; newer?: PlanSession };

function dayDistance(a: string, b: string) {
  return Math.abs(
    new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime(),
  ) / 86_400_000;
}

function substitutionCost(older: PlanSession, newer: PlanSession) {
  const typeCost = older.session_type === newer.session_type ? 0 : 1.25;
  const dayCost = Math.min(dayDistance(older.day, newer.day), 7) * 0.035;
  const oldAmount = older.planned_distance_m ?? older.planned_duration_s ?? 0;
  const newAmount = newer.planned_distance_m ?? newer.planned_duration_s ?? 0;
  const amountCost = oldAmount || newAmount
    ? Math.min(Math.abs(oldAmount - newAmount) / Math.max(oldAmount, newAmount, 1), 1) * 0.25
    : 0;
  return typeCost + dayCost + amountCost;
}

/** Kleine sequence-alignment voor plansessies.
 *
 * Een toegevoegde rust- of loopsessie mag niet alle latere sessies een positie
 * opschuiven en zo een reeks valse wijzigingen veroorzaken. Verwijderen plus
 * toevoegen kost samen meer dan één echte typewijziging, maar minder dan een
 * hele reeks onlogische koppelingen.
 */
function alignSessions(before: PlanSession[], next: PlanSession[]): SessionPair[] {
  const rows = before.length + 1;
  const columns = next.length + 1;
  const scores = Array.from({ length: rows }, () => Array<number>(columns).fill(0));
  const choice = Array.from({ length: rows }, () => Array<"pair" | "remove" | "add">(columns).fill("pair"));
  for (let i = 1; i < rows; i += 1) {
    scores[i][0] = i;
    choice[i][0] = "remove";
  }
  for (let j = 1; j < columns; j += 1) {
    scores[0][j] = j;
    choice[0][j] = "add";
  }

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < columns; j += 1) {
      const options = [
        { kind: "pair" as const, score: scores[i - 1][j - 1] + substitutionCost(before[i - 1], next[j - 1]) },
        { kind: "remove" as const, score: scores[i - 1][j] + 1 },
        { kind: "add" as const, score: scores[i][j - 1] + 1 },
      ].sort((a, b) => a.score - b.score);
      scores[i][j] = options[0].score;
      choice[i][j] = options[0].kind;
    }
  }

  const pairs: SessionPair[] = [];
  let i = before.length;
  let j = next.length;
  while (i > 0 || j > 0) {
    const kind = choice[i][j];
    if (i > 0 && j > 0 && kind === "pair") {
      pairs.push({ older: before[i - 1], newer: next[j - 1] });
      i -= 1;
      j -= 1;
    } else if (i > 0 && (j === 0 || kind === "remove")) {
      pairs.push({ older: before[i - 1] });
      i -= 1;
    } else {
      pairs.push({ newer: next[j - 1] });
      j -= 1;
    }
  }
  return pairs.reverse();
}

/** Productgerichte vergelijking tussen twee gegenereerde planversies.
 *
 * De coach maakt nieuwe database-IDs, dus sessies worden op volgorde binnen het
 * trainingsblok gekoppeld. Zo blijft een wijziging leesbaar als "lange duurloop
 * 10 km → rustige duurloop 7 km" in plaats van twee losse technische records.
 */
export function comparePlans(current: PlanSession[], previous: PlanSession[]): PlanChange[] {
  const next = active(current);
  const before = active(previous);
  if (!before.length) return [];

  const changes: PlanChange[] = [];
  const nextVolume = runVolume(next);
  const beforeVolume = runVolume(before);
  if (Math.abs(nextVolume - beforeVolume) >= 50) {
    changes.push({
      key: "run-volume",
      label: "Hardloopvolume",
      before: distance(beforeVolume) ?? "0 km",
      after: distance(nextVolume) ?? "0 km",
    });
  }

  if (next.length !== before.length) {
    changes.push({
      key: "session-count",
      label: "Aantal trainingen",
      before: String(before.length),
      after: String(next.length),
    });
  }

  const firstDay = [next[0]?.day, before[0]?.day].filter(Boolean).sort()[0] as string;
  for (const { newer, older } of alignSessions(before, next)) {
    if (!newer && older) {
      changes.push({
        key: `removed-${older.id}`,
        label: `Week ${weekNumber(older.day, firstDay)} · training verwijderd`,
        before: sessionSummary(older),
        after: "Rustdag",
      });
      continue;
    }
    if (newer && !older) {
      changes.push({
        key: `added-${newer.id}`,
        label: `Week ${weekNumber(newer.day, firstDay)} · training toegevoegd`,
        before: "Rustdag",
        after: sessionSummary(newer),
      });
      continue;
    }
    if (!newer || !older) continue;

    const materiallyChanged =
      newer.session_type !== older.session_type ||
      newer.day !== older.day ||
      Math.abs((newer.planned_distance_m ?? 0) - (older.planned_distance_m ?? 0)) >= 50 ||
      Math.abs((newer.planned_duration_s ?? 0) - (older.planned_duration_s ?? 0)) >= 60 ||
      newer.hr_cap !== older.hr_cap;
    if (!materiallyChanged) continue;

    changes.push({
      key: `session-${older.id}-${newer.id}`,
      label: `Week ${weekNumber(newer.day, firstDay)} · ${TYPE_LABEL[older.session_type] ?? older.title}`,
      before: sessionSummary(older),
      after: sessionSummary(newer),
    });
  }

  return changes;
}
