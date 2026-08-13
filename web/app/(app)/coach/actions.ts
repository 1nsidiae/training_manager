"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { CoachMessage } from "@/lib/queries";
import { COACH_TOOLS, runCoachTool } from "./tools";

// Hoeveel opzoekrondes de coach mag doen voordat hij moet antwoorden.
const MAX_TOOL_STEPS = 6;

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

Antwoord direct, concreet en menselijk. Gebruik uitsluitend echte data: de meegestuurde app-context, wat je met je gereedschap opzoekt, en de woorden van de atleet. Verzin geen metingen.

De meegestuurde context is een momentopname van de laatste weken, niet zijn hele historie. Zijn Garmin-data loopt terug tot maart 2025 en bevat wedstrijden, trainingsblokken en jaren aan weekcijfers. Zeg dus nooit dat je iets niet hebt voordat je het hebt opgezocht.

Zoek op zodra een vraag verder reikt dan de meegestuurde weken:
- een wedstrijd, een specifieke run of een periode uit het verleden: zoek_activiteiten
- hoe één run verliep, splits en zoneverdeling: activiteit_detail
- een trainingsblok beoordelen, opbouw, weekvolume, belasting: week_overzicht

Bij een vraag als "hoe heb ik me voorbereid op die marathon" zoek je eerst de wedstrijd op en daarna de weken ervoor, en beoordeel je die aanloop met cijfers erbij. Meerdere opzoekingen in één beurt mag; doe ze dan tegelijk.

Vind je echt niets, zeg dan wát je hebt gezocht en over welke periode.

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
    const messages: Anthropic.MessageParam[] = [{
      role: "user",
      content: `RECENT GESPREK\n${transcript || "Nog geen eerder gesprek."}\n\nACTUELE APP-CONTEXT\n${JSON.stringify(context)}\n\nNIEUW BERICHT VAN DE ATLEET\n${content}`,
    }];

    let response: Anthropic.Message | null = null;
    let usedTools: string[] = [];
    const price = PRICE_PER_MTOK[MODEL] ?? { input: 0, output: 0 };
    let costUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedTokens = 0;

    // De coach mag zelf opzoeken. Elke ronde is een volledige modelaanroep, dus
    // de teller is er niet voor de sier: zonder plafond kan één vraag ontsporen
    // in kosten en wachttijd.
    for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
      response = await client.messages.create({
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
        tools: COACH_TOOLS as unknown as Anthropic.Tool[],
        system: systemPrompt(),
        messages,
      });

      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;
      cachedTokens += response.usage.cache_read_input_tokens ?? 0;
      const fresh =
        response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0);
      costUsd +=
        (fresh * price.input +
          (response.usage.cache_read_input_tokens ?? 0) * price.input * 0.1 +
          response.usage.output_tokens * price.output) /
        1_000_000;

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
      if (response.stop_reason !== "tool_use") break;

      const calls = response.content.filter((block) => block.type === "tool_use");
      // Denkblokken horen ongewijzigd terug in de geschiedenis, dus we duwen
      // `content` in zijn geheel terug in plaats van alleen de tool-blokken.
      messages.push({ role: "assistant", content: response.content });

      const results = await Promise.all(
        calls.map(async (call) => {
          usedTools.push(call.name);
          const { result, isError } = await runCoachTool(
            sb,
            call.name,
            call.input as Record<string, unknown>,
          );
          return {
            type: "tool_result" as const,
            tool_use_id: call.id,
            content: JSON.stringify(result),
            is_error: isError,
          };
        }),
      );
      // Alle resultaten in één user-bericht, anders leert het model af om
      // meerdere opzoekingen tegelijk te doen.
      messages.push({ role: "user", content: results });
    }

    if (!response) throw new Error("Coach gaf geen antwoord");
    if (response.stop_reason === "tool_use") {
      throw new Error(`Coach bleef opzoeken na ${MAX_TOOL_STEPS} rondes`);
    }

    const text = response.content.find((block) => block.type === "text")?.text;
    if (!text) throw new Error("Coach gaf geen tekst terug");
    const parsed = parseResponse(text);
    const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
    if (!answer) throw new Error("Coachantwoord mist inhoud");
    const needsPlanReview = parsed.needs_plan_review === true;
    const metadata = {
      needs_plan_review: needsPlanReview,
      review_reason: optionalText(parsed.review_reason),
      safety_note: optionalText(parsed.safety_note),
      model: MODEL,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_tokens: cachedTokens,
      // Welke opzoekingen hij deed; handig om te zien waaróp een antwoord rust.
      tools_used: usedTools,
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
