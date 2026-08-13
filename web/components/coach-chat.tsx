"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Bot, CalendarSync, LoaderCircle, SendHorizontal } from "lucide-react";
import { sendCoachMessage } from "@/app/(app)/coach/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { CoachMessage } from "@/lib/queries";

const QUICK_MESSAGES = [
  "Ik ben ziek en twijfel of ik kan trainen",
  "Deze week voelt te zwaar",
  "Waarom staat mijn volgende training hier?",
];
const POLL_MS = 2_000;
// Een volledige Opus-herplanning kan na een guardrailcorrectie meerdere
// minuten duren. Toon daarom niet voortijdig een fout terwijl de worker nog
// aantoonbaar aan het rekenen is.
const REVIEW_TIMEOUT_MS = 12 * 60_000;

type ReviewState = "idle" | "requested" | "running" | "done" | "error";

function reviewStateFromJob(status: string): ReviewState {
  if (status === "ok") return "done";
  if (status === "requested" || status === "running" || status === "error") return status;
  return "idle";
}

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString("nl-BE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });
}

export function CoachChat({ initialMessages }: { initialMessages: CoachMessage[] }) {
  const [messages, setMessages] = React.useState(initialMessages);
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reviewStates, setReviewStates] = React.useState<Record<number, ReviewState>>({});
  const [reviewErrors, setReviewErrors] = React.useState<Record<number, string>>({});
  const listRef = React.useRef<HTMLDivElement>(null);
  const formRef = React.useRef<HTMLFormElement>(null);
  const reviewPolls = React.useRef(new Set<number>());

  React.useEffect(() => setMessages(initialMessages), [initialMessages]);

  React.useEffect(() => {
    requestAnimationFrame(() => {
      const node = listRef.current;
      if (node) node.scrollTo({ top: node.scrollHeight, behavior: "auto" });
    });
  }, [messages.length]);

  function scrollToLatest(behavior: ScrollBehavior = "smooth") {
    requestAnimationFrame(() => {
      const node = listRef.current;
      if (node) node.scrollTo({ top: node.scrollHeight, behavior });
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    const formData = new FormData();
    formData.set("message", content);
    const result = await sendCoachMessage(formData);
    const received = [result.userMessage, result.assistantMessage].filter(
      (message): message is CoachMessage => Boolean(message),
    );
    if (received.length) {
      setMessages((current) => {
        const known = new Set(current.map((message) => message.id));
        return [...current, ...received.filter((message) => !known.has(message.id))];
      });
      setDraft("");
    }
    setError(result.error);
    setSending(false);
    scrollToLatest();
  }

  function chooseQuickMessage(message: string) {
    setDraft(message);
    requestAnimationFrame(() => formRef.current?.querySelector("textarea")?.focus());
  }

  async function pollReview(messageId: number, requestId: number) {
    if (reviewPolls.current.has(requestId)) return;
    reviewPolls.current.add(requestId);
    const sb = createClient();
    const started = Date.now();
    const timer = window.setInterval(async () => {
      const { data } = await sb
        .from("sync_log")
        .select("status, error")
        .eq("id", requestId)
        .maybeSingle();
      if (!data) return;
      if (data.status === "ok") {
        window.clearInterval(timer);
        reviewPolls.current.delete(requestId);
        setReviewStates((current) => ({ ...current, [messageId]: "done" }));
        return;
      }
      if (data.status === "error" || Date.now() - started > REVIEW_TIMEOUT_MS) {
        window.clearInterval(timer);
        reviewPolls.current.delete(requestId);
        setReviewStates((current) => ({ ...current, [messageId]: "error" }));
        setReviewErrors((current) => ({
          ...current,
          [messageId]: data.error ?? "De planreview duurt abnormaal lang. De worker moet worden gecontroleerd.",
        }));
        return;
      }
      if (data.status === "running") {
        setReviewStates((current) => ({ ...current, [messageId]: "running" }));
      }
    }, POLL_MS);
  }

  React.useEffect(() => {
    const reviewMessages = messages.filter(
      (message) => message.role === "assistant" && message.metadata?.needs_plan_review === true,
    );
    if (!reviewMessages.length) return;
    let cancelled = false;
    const jobs = reviewMessages.map((message) => `coach_chat_review:${message.id}`);
    createClient()
      .from("sync_log")
      .select("id, sync_type, status, error")
      .in("sync_type", jobs)
      .order("id", { ascending: false })
      .then(({ data }) => {
        if (cancelled) return;
        const seen = new Set<string>();
        for (const job of data ?? []) {
          if (seen.has(job.sync_type)) continue;
          seen.add(job.sync_type);
          const messageId = Number(job.sync_type.split(":")[1]);
          if (!Number.isFinite(messageId)) continue;
          setReviewStates((current) => ({
            ...current,
            [messageId]: reviewStateFromJob(job.status),
          }));
          if (job.error) setReviewErrors((current) => ({ ...current, [messageId]: job.error }));
          if (job.status === "requested" || job.status === "running") {
            void pollReview(messageId, job.id);
          }
        }
      });
    return () => {
      cancelled = true;
    };
    // pollReview heeft per request een eigen deduplicatie en levenscyclus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  async function requestPlanReview(messageId: number) {
    const job = `coach_chat_review:${messageId}`;
    setReviewStates((current) => ({ ...current, [messageId]: "requested" }));
    setReviewErrors((current) => ({ ...current, [messageId]: "" }));
    const sb = createClient();
    const { data, error: insertError } = await sb
      .from("sync_log")
      .insert({ sync_type: job, status: "requested" })
      .select("id")
      .single();
    if (insertError) {
      if (insertError.code === "23505") {
        const { data: existing } = await sb
          .from("sync_log")
          .select("id, sync_type, status")
          .in("status", ["requested", "running"])
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existing?.sync_type === job) {
          setReviewStates((current) => ({ ...current, [messageId]: existing.status }));
          void pollReview(messageId, existing.id);
          return;
        }
      }
      setReviewStates((current) => ({ ...current, [messageId]: "error" }));
      setReviewErrors((current) => ({
        ...current,
        [messageId]: "Er loopt al een andere Garmin- of coachtaak. Probeer daarna opnieuw.",
      }));
      return;
    }
    void pollReview(messageId, data.id);
  }

  return (
    <section className="flex h-[min(610px,calc(100dvh-245px))] min-h-[440px] flex-col overflow-hidden rounded-card border border-line bg-s1">
      <div ref={listRef} className="no-scrollbar flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.length === 0 ? (
          <div className="mx-auto flex max-w-[310px] flex-col items-center py-8 text-center">
            <div className="grid size-12 place-items-center rounded-full border border-recovery/25 bg-recovery/10 text-recovery">
              <Bot className="size-5" />
            </div>
            <h2 className="mt-4 text-[17px] font-semibold tracking-[-0.02em]">Praat met je coach</h2>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              Stel een vraag over je schema of vertel hoe je je voelt. Je coach gebruikt je actuele Garmin-data en planning.
            </p>
          </div>
        ) : null}

        {messages.map((message) => {
          const assistant = message.role === "assistant";
          const needsReview = assistant && message.metadata?.needs_plan_review === true;
          const reviewState = reviewStates[message.id] ?? "idle";
          const reviewBusy = reviewState === "requested" || reviewState === "running";
          return (
            <article key={message.id} className={cn("flex", assistant ? "justify-start" : "justify-end")}>
              <div className={cn("max-w-[88%]", assistant ? "w-full" : "") }>
                <div className={cn(
                  "rounded-[16px] px-3.5 py-3 text-[13px] leading-[1.55]",
                  assistant
                    ? "border border-line bg-canvas/45 text-ink"
                    : "ml-auto w-fit bg-recovery text-[#0d1519]",
                )}>
                  {assistant ? <div className="label mb-1.5 text-recovery">Coach</div> : null}
                  <p className="whitespace-pre-wrap">{message.content}</p>
                  {message.metadata?.safety_note ? (
                    <p className="mt-2 border-t border-line pt-2 text-[11px] text-muted">
                      {String(message.metadata.safety_note)}
                    </p>
                  ) : null}
                </div>

                {needsReview ? (
                  <div className="mt-2 rounded-[14px] border border-line bg-s2 p-3">
                    <div className="flex items-start gap-2.5">
                      <CalendarSync className="mt-0.5 size-4 shrink-0 text-recovery" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-semibold">Dit kan je planning beïnvloeden</div>
                        <p className="mt-1 text-[10px] leading-relaxed text-muted">
                          Laat de coach eerst je nieuwste Garmin-data ophalen en een apart voorstel maken. Er verandert nog niets zonder jouw goedkeuring.
                        </p>
                      </div>
                    </div>
                    {reviewState === "done" ? (
                      <Button asChild variant="metric" size="sm" className="mt-3 w-full">
                        <Link href="/plan">Voorstel bekijken <ArrowUpRight /></Link>
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="mt-3 w-full"
                        disabled={reviewBusy}
                        onClick={() => requestPlanReview(message.id)}
                      >
                        {reviewState === "running" ? <LoaderCircle className="animate-spin" /> : <CalendarSync />}
                        {reviewState === "running" ? "Coach beoordeelt schema" : reviewState === "requested" ? "In wachtrij voor coach" : reviewState === "error" ? "Opnieuw proberen" : "Schema laten beoordelen"}
                      </Button>
                    )}
                    {reviewState === "requested" ? (
                      <p className="mt-2 text-[10px] leading-relaxed text-muted">
                        De aanvraag is bewaard maar de coachworker heeft ze nog niet opgepakt.
                      </p>
                    ) : null}
                    {reviewErrors[message.id] ? (
                      <p className="mt-2 text-[10px] leading-relaxed text-danger">{reviewErrors[message.id]}</p>
                    ) : null}
                  </div>
                ) : null}

                <div className={cn("mt-1 px-1 text-[9px] text-faint", assistant ? "text-left" : "text-right")}>
                  {timeLabel(message.created_at)}
                </div>
              </div>
            </article>
          );
        })}
        {sending ? (
          <div className="flex items-center gap-2 text-[11px] text-muted">
            <LoaderCircle className="size-3.5 animate-spin text-recovery" /> Coach leest je data
          </div>
        ) : null}
      </div>

      <div className="border-t border-line bg-s1 p-3">
        <div className="no-scrollbar mb-2.5 flex gap-1.5 overflow-x-auto">
          {QUICK_MESSAGES.map((message) => (
            <button
              key={message}
              type="button"
              onClick={() => chooseQuickMessage(message)}
              className="shrink-0 rounded-full border border-line bg-s2 px-3 py-2 text-[10px] font-semibold text-muted active:bg-s3"
            >
              {message}
            </button>
          ))}
        </div>
        <form ref={formRef} onSubmit={submit} className="flex items-end gap-2">
          <Textarea
            aria-label="Bericht aan je coach"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
            maxLength={1200}
            rows={1}
            placeholder="Vraag iets of vertel hoe je je voelt…"
            className="max-h-28 min-h-11 flex-1 py-2.5"
          />
          <Button type="submit" size="icon" aria-label="Verstuur bericht" disabled={sending || !draft.trim()}>
            {sending ? <LoaderCircle className="animate-spin" /> : <SendHorizontal />}
          </Button>
        </form>
        {error ? <p className="mt-2 text-[10px] leading-relaxed text-danger">{error}</p> : null}
        <p className="mt-2 text-center text-[9px] text-faint">
          Trainingsadvies, geen medische diagnose. Een planwijziging vraagt altijd jouw akkoord.
        </p>
      </div>
    </section>
  );
}
