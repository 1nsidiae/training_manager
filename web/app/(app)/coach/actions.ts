"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { CoachMessage } from "@/lib/queries";

export type SendCoachMessageState = {
  ok: boolean;
  error: string | null;
  userMessage: CoachMessage | null;
  assistantMessage: CoachMessage | null;
};

const EMPTY_STATE: SendCoachMessageState = {
  ok: false,
  error: null,
  userMessage: null,
  assistantMessage: null,
};
const MODEL = "claude-sonnet-5";

// USD per miljoen tokens, naast het model in plaats van los in de berekening —
// anders liegt het kostengetal zodra je van model wisselt.
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** Vaste vorm voor het antwoord. Zonder dit blijft het gokken of het model
 *  geldige JSON teruggeeft; met `additionalProperties: false` en een volledige
 *  `required` staat de vorm vast. Leeg betekent "niet van toepassing" — een
 *  nullable veld voegt hier niets toe behalve schemabeperkingen. */
const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string", description: "Het antwoord in het Nederlands." },
    intent: { type: "string", enum: ["question", "report"] },
    needs_plan_review: { type: "boolean" },
    review_reason: {
      type: "string",
      description: "Waarom het plan herzien moet worden, of leeg.",
    },
    safety_note: {
      type: "string",
      description: "Medische waarschuwing indien nodig, anders leeg.",
    },
  },
  required: ["answer", "intent", "needs_plan_review", "review_reason", "safety_note"],
  additionalProperties: false,
} as const;

function systemPrompt() {
  return `Je bent de persoonlijke trainingscoach in een Nederlandstalige Garmin-trainingsapp.

Antwoord direct, concreet en menselijk. Gebruik uitsluitend de meegestuurde Garmin-data, het actieve schema, coachregels en de woorden van de atleet. Verzin geen metingen. Als data ontbreekt, zeg dat expliciet.

Je mag een schemawijziging aanbevelen, maar nooit beweren dat je het schema al hebt aangepast. Iedere wijziging gebeurt via een afzonderlijk planvoorstel dat de atleet eerst goedkeurt.

Als de atleet ziek is: geef geen diagnose. Stel hoogstens één relevante vervolgvraag als de ernst onduidelijk is. Bij alarmsymptomen zoals pijn op de borst, ernstige benauwdheid, flauwvallen, verwardheid of snelle verslechtering adviseer je dringend professionele medische hulp. Bij koorts, systemische klachten of duidelijke ziekte adviseer je geen intensieve training.

Zet needs_plan_review alleen op true als het bericht de komende trainingen redelijkerwijs kan beïnvloeden: ziekte, pijn, blessure, aanhoudende uitzonderlijke vermoeidheid, onhaalbare planning of een expliciet verzoek om het plan te wijzigen. Een gewone vraag zet dit op false.

Als je eerst een vervolgvraag stelt omdat essentiële informatie ontbreekt, zet je needs_plan_review op false. Er is dan nog niet genoeg informatie voor een degelijk voorstel. Pas nadat de atleet antwoordt en er voldoende context is, mag een volgend antwoord needs_plan_review op true zetten. Vraag nooit om een review en om ontbrekende informatie in hetzelfde antwoord.

Laat review_reason en safety_note leeg wanneer ze niet van toepassing zijn.`;
}

async function buildContext(sb: Awaited<ReturnType<typeof createClient>>) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const fromDate = new Date(`${today}T12:00:00Z`);
  fromDate.setUTCDate(fromDate.getUTCDate() - 21);
  const from = fromDate.toISOString().slice(0, 10);

  const [goal, plan, wellness, activities, rules, feedback] = await Promise.all([
    sb.from("goals").select("goal_type, name, target_date, target_distance_m, target_time_s, params").eq("status", "active").limit(1).maybeSingle(),
    sb.from("plans").select("id, version, summary, reason").eq("status", "active").limit(1).maybeSingle(),
    sb.from("wellness_daily").select("day, sleep_total_s, sleep_score, hrv_last_night_avg, hrv_status, training_readiness_score, training_readiness_level, resting_hr, avg_stress, body_battery_high").gte("day", from).order("day", { ascending: false }).limit(14),
    sb.from("activities").select("sport, sub_sport, name, start_time_local, duration_s, distance_m, avg_hr, max_hr").gte("start_time_local", from).order("start_time_local", { ascending: false }).limit(12),
    sb.from("coach_rules").select("key, class, title, rationale, params").eq("status", "active"),
    sb.from("session_feedback").select("created_at, pain_score, endurance_score, extra, notes").order("created_at", { ascending: false }).limit(6),
  ]);

  let sessions: Record<string, unknown>[] = [];
  if (plan.data?.id) {
    const result = await sb
      .from("plan_sessions")
      .select("day, sport, session_type, title, description, planned_distance_m, planned_duration_s, hr_cap, status, targets")
      .eq("plan_id", plan.data.id)
      .in("status", ["planned", "moved"])
      .gte("day", today)
      .order("day")
      .limit(20);
    sessions = result.data ?? [];
  }

  return {
    today,
    goal: goal.data,
    active_plan: plan.data,
    upcoming_sessions: sessions,
    recent_wellness: wellness.data ?? [],
    recent_activities: activities.data ?? [],
    coach_rules: rules.data ?? [],
    recent_feedback: feedback.data ?? [],
  };
}

/** Het schema garandeert dat het eerste tekstblok geldige JSON is, dus hier
 *  geen hekjes strippen meer. */
function parseResponse(value: string) {
  return JSON.parse(value) as {
    answer?: unknown;
    intent?: unknown;
    needs_plan_review?: unknown;
    review_reason?: unknown;
    safety_note?: unknown;
  };
}

/** Leeg veld betekent "niet van toepassing"; dat bewaren we als null. */
function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function sendCoachMessage(formData: FormData): Promise<SendCoachMessageState> {
  const content = String(formData.get("message") ?? "").trim();
  if (!content) return { ...EMPTY_STATE, error: "Schrijf eerst iets voor je coach." };
  if (content.length > 1200) {
    return { ...EMPTY_STATE, error: "Hou je bericht onder 1.200 tekens." };
  }

  const sb = await createClient();
  const { data: auth, error: authError } = await sb.auth.getUser();
  if (authError || !auth.user) {
    return { ...EMPTY_STATE, error: "Je sessie is verlopen. Log opnieuw in." };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ...EMPTY_STATE, error: "De coachverbinding is nog niet ingesteld op de webserver." };
  }

  const { data: userMessage, error: insertError } = await sb
    .from("coach_messages")
    .insert({ user_id: auth.user.id, role: "user", content, intent: "question", metadata: {} })
    .select("id, user_id, role, content, intent, metadata, created_at")
    .single();
  if (insertError) {
    const missing = insertError.code === "42P01" || insertError.code === "PGRST205";
    return {
      ...EMPTY_STATE,
      error: missing
        ? "De coachchat-database is nog niet geactiveerd. Voer eerst docs/coach_chat.sql uit."
        : "Je bericht kon niet veilig worden opgeslagen.",
    };
  }

  try {
    const [{ data: history }, context] = await Promise.all([
      sb
        .from("coach_messages")
        .select("role, content")
        .eq("user_id", auth.user.id)
        .neq("id", userMessage.id)
        .order("created_at", { ascending: false })
        .limit(12),
      buildContext(sb),
    ]);
    const transcript = [...(history ?? [])]
      .reverse()
      .map((item) => `${item.role === "assistant" ? "COACH" : "ATLEET"}: ${item.content}`)
      .join("\n\n");
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: MODEL,
      // Sonnet 5 denkt als je `thinking` weglaat, en denktokens tellen mee in
      // max_tokens. Met de oude 1200 kapte een antwoord daardoor middenin de
      // JSON af. Expliciet zetten, en ruimte geven.
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: ANSWER_SCHEMA },
      },
      system: systemPrompt(),
      messages: [{
        role: "user",
        content: `RECENT GESPREK\n${transcript || "Nog geen eerder gesprek."}\n\nACTUELE APP-CONTEXT\n${JSON.stringify(context)}\n\nNIEUW BERICHT VAN DE ATLEET\n${content}`,
      }],
    });

    // Afgekapte JSON geeft anders een onleesbare parse-fout, en een weigering
    // levert helemaal geen tekstblok op. Allebei eerst benoemen.
    if (response.stop_reason === "max_tokens") {
      throw new Error("Antwoord afgekapt op max_tokens; JSON onvolledig");
    }
    if (response.stop_reason === "refusal") {
      throw new Error(
        `Model weigerde te antwoorden (${response.stop_details?.category ?? "onbekend"})`,
      );
    }

    const text = response.content.find((block) => block.type === "text")?.text;
    if (!text) throw new Error("Coach gaf geen tekst terug");
    const parsed = parseResponse(text);
    const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
    if (!answer) throw new Error("Coachantwoord mist inhoud");
    const needsPlanReview = parsed.needs_plan_review === true;
    const price = PRICE_PER_MTOK[MODEL] ?? { input: 0, output: 0 };
    const cachedTokens = response.usage.cache_read_input_tokens ?? 0;
    const freshTokens =
      response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0);
    const costUsd =
      (freshTokens * price.input +
        cachedTokens * price.input * 0.1 +
        response.usage.output_tokens * price.output) /
      1_000_000;
    const metadata = {
      needs_plan_review: needsPlanReview,
      review_reason: optionalText(parsed.review_reason),
      safety_note: optionalText(parsed.safety_note),
      model: MODEL,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_tokens: cachedTokens,
      cost_usd: Math.round(costUsd * 100_000) / 100_000,
    };
    const { data: assistantMessage, error } = await sb
      .from("coach_messages")
      .insert({
        user_id: auth.user.id,
        role: "assistant",
        content: answer,
        intent: needsPlanReview ? "plan_review" : parsed.intent === "report" ? "report" : "question",
        metadata,
      })
      .select("id, user_id, role, content, intent, metadata, created_at")
      .single();
    if (error) throw error;
    revalidatePath("/coach");
    return {
      ok: true,
      error: null,
      userMessage: userMessage as CoachMessage,
      assistantMessage: assistantMessage as CoachMessage,
    };
  } catch (cause) {
    // Zonder dit zien een verkeerde API-key, een rate limit en een afgekapt
    // antwoord er in de app identiek uit.
    console.error("[coach] antwoord mislukt", cause);
    return {
      ok: false,
      error: "De coach kon nu niet antwoorden. Je bericht is wel bewaard; probeer het zo opnieuw.",
      userMessage: userMessage as CoachMessage,
      assistantMessage: null,
    };
  }
}
