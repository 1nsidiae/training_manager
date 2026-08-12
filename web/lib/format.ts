import type { SessionType } from "./queries";

/* Activiteiten gebruiken een herkenbaar spectrum dat is afgeleid van het
   WHOOP-palet. Elk type houdt in badges, weekoverzichten en structuurbalken
   exact dezelfde kleur; het tekstlabel blijft altijd zichtbaar. */
export const SESSION_META: Record<
  SessionType,
  { label: string; color: string; dot: string; badge: string; hex: string }
> = {
  walk_run: {
    label: "Wandel-loop", color: "text-run-walk", dot: "bg-run-walk",
    badge: "border-run-walk/30 bg-run-walk/10 text-run-walk", hex: "#7ba1bb",
  },
  recovery: {
    label: "Herstel", color: "text-run-recovery", dot: "bg-run-recovery",
    badge: "border-run-recovery/30 bg-run-recovery/10 text-run-recovery", hex: "#67aee6",
  },
  easy: {
    label: "Rustig", color: "text-run-easy", dot: "bg-run-easy",
    badge: "border-run-easy/30 bg-run-easy/10 text-run-easy", hex: "#0093e7",
  },
  long: {
    label: "Lange duurloop", color: "text-run-long", dot: "bg-run-long",
    badge: "border-run-long/30 bg-run-long/10 text-run-long", hex: "#00bdd6",
  },
  tempo: {
    label: "Tempo", color: "text-run-tempo", dot: "bg-run-tempo",
    badge: "border-run-tempo/30 bg-run-tempo/10 text-run-tempo", hex: "#00f19f",
  },
  interval: {
    label: "Interval", color: "text-run-interval", dot: "bg-run-interval",
    badge: "border-run-interval/30 bg-run-interval/10 text-run-interval", hex: "#a9e600",
  },
  race: {
    label: "Wedstrijd", color: "text-run-race", dot: "bg-run-race",
    badge: "border-run-race/30 bg-run-race/10 text-run-race", hex: "#ffde00",
  },
  strength: {
    label: "Kracht", color: "text-run-strength", dot: "bg-run-strength",
    badge: "border-run-strength/30 bg-run-strength/10 text-run-strength", hex: "#ff6257",
  },
  cross_training: {
    label: "Cross", color: "text-run-cross", dot: "bg-run-cross",
    badge: "border-run-cross/30 bg-run-cross/10 text-run-cross", hex: "#7f86ff",
  },
  rest: {
    label: "Rust", color: "text-faint", dot: "bg-s3",
    badge: "border-line bg-s3/70 text-faint", hex: "#7f898d",
  },
};

/** HR-zones van rustig naar hard. Semantisch: groen is herstelbaar, rood niet. */
export const ZONE_COLORS = ["#7ba1bb", "#67aee6", "#00f19f", "#ffde00", "#ff0026"];

export function km(meters: number | null | undefined): string {
  if (!meters) return "–";
  return `${(meters / 1000).toFixed(1)} km`;
}

/** Tempo als m:ss. Zonder eenheid, want die staat er in de UI al naast. */
export function pace(secondsPerKm: number | null | undefined): string {
  if (!secondsPerKm) return "–";
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Tempodoel van een stap: één waarde of een band, of niets. */
export function paceTarget(step: {
  pace_min_s_per_km?: number;
  pace_max_s_per_km?: number;
}): string | null {
  const fast = step.pace_min_s_per_km ?? 0;
  const slow = step.pace_max_s_per_km ?? 0;
  if (!fast && !slow) return null;
  if (fast && slow && Math.abs(slow - fast) > 4) return `${pace(fast)}–${pace(slow)}`;
  return pace(fast || slow);
}

export function duration(seconds: number | null | undefined): string {
  if (!seconds) return "–";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}u ${String(m % 60).padStart(2, "0")}`;
}

export function hours(seconds: number | null | undefined): string {
  if (!seconds) return "–";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}u ${String(m).padStart(2, "0")}`;
}

const DAYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
const MONTHS = [
  "jan", "feb", "mrt", "apr", "mei", "jun",
  "jul", "aug", "sep", "okt", "nov", "dec",
];

export function dayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function shortDay(iso: string): string {
  return DAYS[new Date(`${iso}T12:00:00`).getDay()];
}

export function relativeDay(iso: string): string {
  const target = new Date(`${iso}T12:00:00`).setHours(0, 0, 0, 0);
  const now = new Date().setHours(0, 0, 0, 0);
  const diff = Math.round((target - now) / 86_400_000);
  if (diff === 0) return "Vandaag";
  if (diff === 1) return "Morgen";
  if (diff === -1) return "Gisteren";
  if (diff > 1) return `Over ${diff} dagen`;
  return `${Math.abs(diff)} dagen geleden`;
}

type Tone = { color: string; hex: string; label: string };

/* Staat wordt nooit alleen door kleur gedragen: er staat altijd een woord bij. */
export function readinessTone(score: number | null | undefined): Tone {
  if (score == null) return { color: "text-off", hex: "#586267", label: "Geen meting" };
  // Garmin Training Readiness: Prime 95-100, High 75-94,
  // Moderate 50-74, Low 25-49 en Poor 1-24.
  if (score >= 95) return { color: "text-high", hex: "#16ec06", label: "Uitstekend" };
  if (score >= 75) return { color: "text-high", hex: "#16ec06", label: "Hoog" };
  if (score >= 50) return { color: "text-medium", hex: "#ffde00", label: "Gematigd" };
  if (score >= 25) return { color: "text-low", hex: "#ff0026", label: "Laag" };
  return { color: "text-low", hex: "#ff0026", label: "Slecht" };
}

export function sleepTone(seconds: number | null | undefined): Tone {
  if (seconds == null) return { color: "text-off", hex: "#586267", label: "Geen meting" };
  const h = seconds / 3600;
  if (h >= 7) return { color: "text-sleep", hex: "#7ba1bb", label: "Voldoende" };
  if (h >= 6) return { color: "text-medium", hex: "#ffde00", label: "Krap" };
  return { color: "text-low", hex: "#ff0026", label: "Te kort" };
}

export function hrvTone(status: string | null | undefined): Tone {
  if (status === "BALANCED")
    return { color: "text-recovery", hex: "#67aee6", label: "Gebalanceerd" };
  if (status === "UNBALANCED")
    return { color: "text-medium", hex: "#ffde00", label: "Niet gebalanceerd" };
  if (status === "LOW")
    return { color: "text-low", hex: "#ff0026", label: "Laag" };
  if (status === "POOR")
    return { color: "text-low", hex: "#ff0026", label: "Slecht" };
  return { color: "text-off", hex: "#586267", label: "Geen status" };
}
