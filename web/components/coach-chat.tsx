"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import {
  ArrowUpRight,
  Bot,
  CalendarSync,
  LoaderCircle,
  MessageCircle,
  SendHorizontal,
  X,
} from "lucide-react";
import { sendCoachMessage } from "@/app/(app)/coach/actions";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
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
  const [open, setOpen] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [reviewStates, setReviewStates] = React.useState<Record<number, ReviewState>>({});
  const listRef = React.useRef<HTMLDivElement>(null);
  const formRef = React.useRef<HTMLFormElement>(null);
  const reviewPolls = React.useRef(new Set<number>());

  React.useEffect(() => setMessages(initialMessages), [initialMessages]);

  React.useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      const node = listRef.current;
      if (node) node.scrollTo({ top: node.scrollHeight, behavior: "auto" });
    });
  }, [messages.length, open]);

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
    if (result.error) {
      toast.error("Bericht niet verstuurd", {
        description: result.error,
        duration: 6500,
      });
    }
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
        toast.success("Planreview klaar", {
          description: "Je kunt het voorstel nu op de planpagina bekijken.",
        });
        return;
      }
      if (data.status === "error" || Date.now() - started > REVIEW_TIMEOUT_MS) {
        window.clearInterval(timer);
        reviewPolls.current.delete(requestId);
        setReviewStates((current) => ({ ...current, [messageId]: "error" }));
        toast.error("Planreview niet afgerond", {
          description: data.error ?? "De review duurt abnormaal lang. Controleer de coachworker.",
          duration: 6500,
        });
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
      toast.warning("Planreview niet gestart", {
        description: "Er loopt al een andere Garmin- of coachtaak. Probeer daarna opnieuw.",
        duration: 6500,
      });
      return;
    }
    void pollReview(messageId, data.id);
  }

  const latestMessage = messages[messages.length - 1];
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <section className="overflow-hidden rounded-card border border-line bg-s1">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
          <div className="grid size-10 shrink-0 place-items-center rounded-full border border-teal/20 bg-teal/10 text-teal">
            <Bot className="size-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold tracking-[-0.02em]">Gesprek met je coach</h2>
            <p className="mt-0.5 text-[10px] text-faint">
              {messages.length ? `${messages.length} berichten` : "Nog geen berichten"} · Garmin- en plancontext actief
            </p>
          </div>
          <span className="size-2 rounded-full bg-teal" aria-label="Coach beschikbaar" />
        </div>

        <div className="px-4 py-4">
          {latestAssistant ? (
            <>
              <div className="label mb-2 text-recovery">Laatste antwoord</div>
              <p className="line-clamp-4 text-[13px] leading-[1.6] text-muted">
                {latestAssistant.content}
              </p>
              <div className="mt-2 text-[9px] text-faint">{timeLabel(latestAssistant.created_at)}</div>
            </>
          ) : (
            <p className="max-w-sm text-[13px] leading-relaxed text-muted">
              Vraag iets over je schema of vertel hoe je je voelt. De coach gebruikt je actuele Garmin-data en planning.
            </p>
          )}

          <Dialog.Trigger asChild>
            <Button variant="secondary" className="mt-4 w-full">
              <MessageCircle /> {latestMessage ? "Gesprek openen" : "Nieuw gesprek"}
            </Button>
          </Dialog.Trigger>
        </div>
      </section>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-canvas" />
        <Dialog.Content
          className="coach-chat-focus fixed inset-0 z-[100] grid w-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-canvas text-ink outline-none"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <header className="border-b border-line bg-base/95 px-[max(12px,env(safe-area-inset-left))] pb-3 pt-[max(10px,env(safe-area-inset-top))] backdrop-blur-xl">
            <div className="mx-auto grid max-w-lg grid-cols-[44px_minmax(0,1fr)_44px] items-center">
              <Dialog.Close asChild>
                <Button variant="icon" size="icon" aria-label="Gesprek sluiten" className="bg-transparent">
                  <X />
                </Button>
              </Dialog.Close>
              <div className="min-w-0 text-center">
                <Dialog.Title className="text-[15px] font-semibold tracking-[-0.02em]">Coach</Dialog.Title>
                <Dialog.Description className="mt-0.5 truncate text-[9px] font-semibold uppercase tracking-[0.08em] text-recovery">
                  Garmin + actief plan
                </Dialog.Description>
              </div>
              <div className="grid size-9 place-self-end place-items-center rounded-full border border-teal/20 bg-teal/10 text-teal">
                <Bot className="size-4" />
              </div>
            </div>
          </header>

          <div
            ref={listRef}
            className="no-scrollbar min-h-0 overflow-y-auto overscroll-contain px-[max(16px,env(safe-area-inset-left))] py-5 [overflow-anchor:none] [-webkit-overflow-scrolling:touch]"
            aria-live="polite"
          >
            <div className="mx-auto max-w-lg space-y-5">
              {messages.length === 0 ? (
                <div className="mx-auto flex max-w-[310px] flex-col items-center py-16 text-center">
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
                    <div className={cn(assistant ? "w-full max-w-[92%]" : "max-w-[82%]") }>
                      <div className={cn(
                        "rounded-[18px] px-4 py-3.5 text-[14px] leading-[1.55]",
                        assistant
                          ? "rounded-tl-[5px] border border-line bg-s1 text-ink"
                          : "rounded-tr-[5px] bg-recovery text-[#0d1519]",
                      )}>
                        {assistant ? <div className="label mb-2 text-recovery">Coach</div> : null}
                        <p className="whitespace-pre-wrap">{message.content}</p>
                        {message.metadata?.safety_note ? (
                          <p className="mt-3 border-t border-line pt-3 text-[11px] text-muted">
                            {String(message.metadata.safety_note)}
                          </p>
                        ) : null}
                      </div>

                      {needsReview ? (
                        <div className="mt-2 rounded-[16px] border border-line bg-s2 p-3.5">
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
                        </div>
                      ) : null}

                      <div className={cn("mt-1.5 px-1 text-[9px] text-faint", assistant ? "text-left" : "text-right")}>
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
          </div>

          <footer className="border-t border-line bg-base/95 px-[max(12px,env(safe-area-inset-left))] pb-[max(10px,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-xl">
            <div className="mx-auto max-w-lg">
              <div className="no-scrollbar mb-2 flex gap-1.5 overflow-x-auto">
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
                  className="max-h-28 min-h-11 flex-1 py-2.5 text-[16px] sm:text-sm"
                />
                <Button type="submit" size="icon" aria-label="Verstuur bericht" disabled={sending || !draft.trim()}>
                  {sending ? <LoaderCircle className="animate-spin" /> : <SendHorizontal />}
                </Button>
              </form>
              <p className="mt-1.5 text-center text-[9px] text-faint">
                Trainingsadvies · geen medische diagnose
              </p>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
