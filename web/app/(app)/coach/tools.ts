import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Gereedschap waarmee de coach zelf in je historie kan kijken.
 *
 * Tot nu toe kreeg de chat één vast blokje data mee: 21 dagen activiteiten,
 * 14 dagen wellness. Dat is precies genoeg om over vandaag te praten en te
 * weinig voor "hoe heb ik voor mijn marathon getraind" — dan antwoordde hij
 * eerlijk maar misleidend dat hij nul activiteiten zag, terwijl er 83 in de
 * database staan.
 *
 * Vooraf alles meesturen is geen optie: 83 activiteiten met splits erbij is
 * een veelvoud van de context die een gesprek nodig heeft, en je betaalt hem
 * bij elk bericht opnieuw. Daarom mag de coach nu zelf opvragen wat hij nodig
 * heeft. Alles hier is leesbewerking; het schema wijzigen loopt onveranderd via
 * het bestaande planvoorstel dat jij goedkeurt.
 */

const MAX_ACTIVITIES = 60;
const MAX_WEEKS = 60;

export const COACH_TOOLS = [
  {
    name: "zoek_activiteiten",
    description:
      "Zoek voltooide activiteiten uit de Garmin-historie van de atleet. " +
      "Gebruik dit zodra een vraag over het verleden gaat: een wedstrijd, een " +
      "specifieke periode, de langste of snelste runs, of hoeveel er in een " +
      "maand gelopen is. De data loopt terug tot maart 2025. " +
      "Geeft per activiteit datum, naam, sport, afstand, duur, tempo, " +
      "gemiddelde en maximale hartslag, hoogtemeters en het activiteit-id " +
      "waarmee je `activiteit_detail` kunt opvragen. " +
      "Zonder datums krijg je de meest recente activiteiten.",
    input_schema: {
      type: "object",
      properties: {
        van: { type: "string", description: "Startdatum als YYYY-MM-DD." },
        tot: { type: "string", description: "Einddatum als YYYY-MM-DD." },
        sport: {
          type: "string",
          description: "Bijvoorbeeld running, cycling, swimming. Leeg = alle sporten.",
        },
        min_afstand_km: {
          type: "number",
          description: "Alleen activiteiten vanaf deze afstand. Handig om wedstrijden te vinden.",
        },
        sorteer_op: {
          type: "string",
          enum: ["datum", "afstand"],
          description: "Standaard datum, nieuwste eerst. 'afstand' geeft de langste eerst.",
        },
        limiet: { type: "number", description: `Maximum aantal, standaard 20, hoogstens ${MAX_ACTIVITIES}.` },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "activiteit_detail",
    description:
      "Haal één activiteit in detail op: alle ronden (splits) met hun tempo en " +
      "hartslag, plus de verdeling over de hartslagzones. Gebruik dit wanneer " +
      "de atleet wil weten hoe een run verliep — of hij gelijkmatig liep, waar " +
      "hij instortte, hoeveel tijd in welke zone. Het id komt uit `zoek_activiteiten`.",
    input_schema: {
      type: "object",
      properties: {
        activiteit_id: { type: "number", description: "Het id uit zoek_activiteiten." },
      },
      required: ["activiteit_id"],
      additionalProperties: false,
    },
  },
  {
    name: "week_overzicht",
    description:
      "Weekcijfers over een periode: afstand, aantal sessies, tijd per " +
      "hartslagzone, het aandeel rustig, acute en chronische belasting, ACWR, " +
      "monotonie, en gemiddelde slaap en readiness per week. " +
      "Dit is het gereedschap voor vragen over een trainingsblok — 'hoe heb ik " +
      "me voorbereid op die marathon', 'hoeveel liep ik toen per week', 'was " +
      "mijn opbouw te snel'. Vraag de weken vóór een wedstrijd op om de " +
      "aanloop te beoordelen.",
    input_schema: {
      type: "object",
      properties: {
        van: { type: "string", description: "Startdatum als YYYY-MM-DD." },
        tot: { type: "string", description: "Einddatum als YYYY-MM-DD." },
      },
      required: ["van", "tot"],
      additionalProperties: false,
    },
  },
] as const;

function mmss(seconds: number | null): string | null {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function hms(seconds: number | null): string | null {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/** Afgeronde, leesbare velden in plaats van ruwe kolommen: het model rekent
 *  niet beter van vier decimalen, en elke overbodige token betaal je. */
type ToolInput = Record<string, unknown>;

async function zoekActiviteiten(sb: SupabaseClient, input: ToolInput) {
  const limiet = Math.min(Number(input.limiet) || 20, MAX_ACTIVITIES);
  let query = sb
    .from("activities")
    .select(
      "id, start_time_local, name, sport, distance_m, duration_s, avg_pace_s_per_km, avg_hr, max_hr, elevation_gain_m",
    );

  if (typeof input.van === "string" && input.van) query = query.gte("start_time_local", input.van);
  if (typeof input.tot === "string" && input.tot) {
    // Inclusief de einddatum zelf, ook al staat er een tijdstip achter.
    query = query.lte("start_time_local", `${input.tot}T23:59:59`);
  }
  if (typeof input.sport === "string" && input.sport) query = query.eq("sport", input.sport);
  if (Number(input.min_afstand_km) > 0) {
    query = query.gte("distance_m", Number(input.min_afstand_km) * 1000);
  }

  query =
    input.sorteer_op === "afstand"
      ? query.order("distance_m", { ascending: false, nullsFirst: false })
      : query.order("start_time_local", { ascending: false });

  const { data, error } = await query.limit(limiet);
  if (error) return { fout: error.message };
  if (!data?.length) return { gevonden: 0, activiteiten: [], opmerking: "Niets in deze selectie." };

  return {
    gevonden: data.length,
    activiteiten: data.map((a) => ({
      id: a.id,
      datum: String(a.start_time_local).slice(0, 10),
      naam: a.name,
      sport: a.sport,
      km: a.distance_m ? Math.round(a.distance_m / 10) / 100 : null,
      tijd: hms(a.duration_s),
      tempo_per_km: mmss(a.avg_pace_s_per_km),
      gem_hr: a.avg_hr,
      max_hr: a.max_hr,
      hoogtemeters: a.elevation_gain_m,
    })),
  };
}

async function activiteitDetail(sb: SupabaseClient, input: ToolInput) {
  const id = Number(input.activiteit_id);
  if (!Number.isFinite(id)) return { fout: "activiteit_id ontbreekt of is geen getal." };

  const [{ data: activity }, { data: laps }, { data: zones }] = await Promise.all([
    sb
      .from("activities")
      .select(
        "id, start_time_local, name, sport, distance_m, duration_s, avg_pace_s_per_km, avg_hr, max_hr, elevation_gain_m, calories, aerobic_training_effect, vo2max",
      )
      .eq("id", id)
      .maybeSingle(),
    sb
      .from("activity_laps")
      .select("lap_index, distance_m, duration_s, avg_pace_s_per_km, avg_hr, max_hr, elevation_gain_m")
      .eq("activity_id", id)
      .order("lap_index")
      .limit(80),
    sb
      .from("activity_zones")
      .select("zone_number, seconds_in_zone, hr_low, hr_high")
      .eq("activity_id", id)
      .order("zone_number"),
  ]);

  if (!activity) return { fout: `Geen activiteit met id ${id}.` };

  return {
    activiteit: {
      datum: String(activity.start_time_local).slice(0, 10),
      naam: activity.name,
      sport: activity.sport,
      km: activity.distance_m ? Math.round(activity.distance_m / 10) / 100 : null,
      tijd: hms(activity.duration_s),
      tempo_per_km: mmss(activity.avg_pace_s_per_km),
      gem_hr: activity.avg_hr,
      max_hr: activity.max_hr,
      hoogtemeters: activity.elevation_gain_m,
      calorieen: activity.calories,
      aeroob_effect: activity.aerobic_training_effect,
      vo2max: activity.vo2max,
    },
    ronden: (laps ?? []).map((l) => ({
      ronde: l.lap_index,
      km: l.distance_m ? Math.round(l.distance_m / 10) / 100 : null,
      tijd: hms(l.duration_s),
      tempo_per_km: mmss(l.avg_pace_s_per_km),
      gem_hr: l.avg_hr,
      max_hr: l.max_hr,
    })),
    hartslagzones: (zones ?? []).map((z) => ({
      zone: z.zone_number,
      minuten: Math.round((z.seconds_in_zone ?? 0) / 60),
      hr_van: z.hr_low,
      hr_tot: z.hr_high,
    })),
  };
}

async function weekOverzicht(sb: SupabaseClient, input: ToolInput) {
  const van = String(input.van ?? "");
  const tot = String(input.tot ?? "");
  if (!van || !tot) return { fout: "van en tot zijn allebei verplicht (YYYY-MM-DD)." };

  const { data, error } = await sb
    .from("weekly_metrics")
    .select(
      "week_start, distance_m, duration_s, session_count, zone1_s, zone2_s, zone3_s, zone4_s, zone5_s, easy_share, acute_load, chronic_load, acwr, monotony, avg_sleep_s, avg_readiness",
    )
    .gte("week_start", van)
    .lte("week_start", tot)
    .order("week_start")
    .limit(MAX_WEEKS);

  if (error) return { fout: error.message };
  if (!data?.length) return { gevonden: 0, weken: [], opmerking: "Geen weken in deze periode." };

  return {
    gevonden: data.length,
    weken: data.map((w) => {
      const zoneMin = [w.zone1_s, w.zone2_s, w.zone3_s, w.zone4_s, w.zone5_s].map((s) =>
        Math.round((s ?? 0) / 60),
      );
      return {
        week: w.week_start,
        km: w.distance_m ? Math.round(w.distance_m / 100) / 10 : 0,
        uren: w.duration_s ? Math.round((w.duration_s / 3600) * 10) / 10 : 0,
        sessies: w.session_count,
        minuten_per_zone: { z1: zoneMin[0], z2: zoneMin[1], z3: zoneMin[2], z4: zoneMin[3], z5: zoneMin[4] },
        aandeel_rustig: w.easy_share == null ? null : Math.round(w.easy_share * 100) / 100,
        acwr: w.acwr == null ? null : Math.round(w.acwr * 100) / 100,
        monotonie: w.monotony == null ? null : Math.round(w.monotony * 100) / 100,
        gem_slaap_u: w.avg_sleep_s ? Math.round((w.avg_sleep_s / 3600) * 10) / 10 : null,
        gem_readiness: w.avg_readiness,
      };
    }),
  };
}

const HANDLERS: Record<string, (sb: SupabaseClient, input: ToolInput) => Promise<unknown>> = {
  zoek_activiteiten: zoekActiviteiten,
  activiteit_detail: activiteitDetail,
  week_overzicht: weekOverzicht,
};

export async function runCoachTool(
  sb: SupabaseClient,
  name: string,
  input: ToolInput,
): Promise<{ result: unknown; isError: boolean }> {
  const handler = HANDLERS[name];
  if (!handler) return { result: { fout: `Onbekend gereedschap: ${name}` }, isError: true };
  try {
    const result = await handler(sb, input ?? {});
    // Een `fout`-veld is een net antwoord, geen crash: de coach kan er zelf op
    // reageren door anders te zoeken.
    const isError = Boolean((result as { fout?: unknown })?.fout);
    return { result, isError };
  } catch (cause) {
    console.error(`[coach-tool] ${name} faalde`, cause);
    return { result: { fout: "Het opzoeken mislukte." }, isError: true };
  }
}
