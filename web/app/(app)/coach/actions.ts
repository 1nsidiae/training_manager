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

function systemPrompt() {
  return `Je bent de persoonlijke trainingscoach in een Nederlandstalige Garmin-trainingsapp.

Antwoord direct, concreet en menselijk. Gebruik uitsluitend de meegestuurde Garmin-data, het actieve schema, coachregels en de woorden van de atleet. Verzin geen metingen. Als data ontbreekt, zeg dat expliciet.

Je mag een schemawijziging aanbevelen, maar nooit beweren dat je het schema al hebt aangepast. Iedere wijziging gebeurt via een afzonderlijk planvoorstel dat de atleet eerst goedkeurt.

Als de atleet ziek is: geef geen diagnose. Stel hoogstens één relevante vervolgvraag als de ernst onduidelijk is. Bij alarmsymptomen zoals pijn op de borst, ernstige benauwdheid, flauwvallen, verwardheid of snelle verslechtering adviseer je dringend professionele medische hulp. Bij koorts, systemische klachten of duidelijke ziekte adviseer je geen intensieve training.

Zet needs_plan_review alleen op true als het bericht de komende trainingen redelijkerwijs kan beïnvloeden: ziekte, pijn, blessure, aanhoudende uitzonderlijke vermoeidheid, onhaalbare planning of een expliciet verzoek om het plan te wijzigen. Een gewone vraag zet dit op false.

Geef uitsluitend geldige JSON terug in deze vorm:
{"answer":"antwoord in het Nederlands","intent":"question|report","needs_plan_review":false,"review_reason":null,"safety_note":null}`;
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

function parseResponse(value: string) {
  const clean = value.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(clean) as {
    answer?: unknown;
    intent?: unknown;
    needs_plan_review?: unknown;
    review_reason?: unknown;
    safety_note?: unknown;
  };
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
      max_tokens: 1200,
      system: systemPrompt(),
      messages: [{
        role: "user",
        content: `RECENT GESPREK\n${transcript || "Nog geen eerder gesprek."}\n\nACTUELE APP-CONTEXT\n${JSON.stringify(context)}\n\nNIEUW BERICHT VAN DE ATLEET\n${content}`,
      }],
    });
    const text = response.content.find((block) => block.type === "text")?.text;
    if (!text) throw new Error("Coach gaf geen tekst terug");
    const parsed = parseResponse(text);
    const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
    if (!answer) throw new Error("Coachantwoord mist inhoud");
    const needsPlanReview = parsed.needs_plan_review === true;
    const costUsd = (
      response.usage.input_tokens * 3 + response.usage.output_tokens * 15
    ) / 1_000_000;
    const metadata = {
      needs_plan_review: needsPlanReview,
      review_reason: typeof parsed.review_reason === "string" ? parsed.review_reason.trim() : null,
      safety_note: typeof parsed.safety_note === "string" ? parsed.safety_note.trim() : null,
      model: MODEL,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
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
  } catch {
    return {
      ok: false,
      error: "De coach kon nu niet antwoorden. Je bericht is wel bewaard; probeer het zo opnieuw.",
      userMessage: userMessage as CoachMessage,
      assistantMessage: null,
    };
  }
}
