"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowUpRight,
  CalendarClock,
  Check,
  Gauge,
  HeartPulse,
  LoaderCircle,
  MessageSquareText,
  Moon,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
import { DetailDrawer } from "@/components/detail-drawer";
import { createClient } from "@/lib/supabase/client";
import type { PlanSession } from "@/lib/queries";
import type {
  PreWorkoutCheck,
  PreWorkoutDecision,
  PreWorkoutSignal,
  PreWorkoutSignalTone,
} from "@/lib/pre-workout";

const POLL_MS = 2_000;
// Een volledige Garmin-sync plus Opus-planreview kan enkele minuten duren.
const WORKER_TIMEOUT_MS = 5 * 60_000;

type ReviewState = "idle" | "requested" | "running" | "done" | "error" | "no_worker";

const DECISION_STYLE: Record<
  PreWorkoutDecision,
  { icon: typeof ShieldCheck; iconClass: string; borderClass: string; eyebrow: string }
> = {
  go: {
    icon: ShieldCheck,
    iconClass: "bg-teal/10 text-teal",
    borderClass: "border-teal/25",
    eyebrow: "Klaar voor training",
  },
  lighten: {
    icon: Gauge,
    iconClass: "bg-warning/10 text-warning",
    borderClass: "border-warning/30",
    eyebrow: "Belasting aanpassen",
  },
  move: {
    icon: CalendarClock,
    iconClass: "bg-blue/10 text-blue",
    borderClass: "border-blue/30",
    eyebrow: "Timing aanpassen",
  },
  recover: {
    icon: TriangleAlert,
    iconClass: "bg-danger/10 text-danger",
    borderClass: "border-danger/30",
    eyebrow: "Veiligheidsgrens geraakt",
  },
};

const SIGNAL_ICON: Record<PreWorkoutSignal["key"], typeof Activity> = {
  readiness: Gauge,
  sleep: Moon,
  hrv: HeartPulse,
  resting_hr: Activity,
  load: Activity,
  feedback: MessageSquareText,
};

const SIGNAL_STYLE: Record<PreWorkoutSignalTone, string> = {
  good: "bg-teal/10 text-teal",
  neutral: "bg-s3 text-muted",
  watch: "bg-warning/10 text-warning",
  stop: "bg-danger/10 text-danger",
};

const DECISION_TEXT: Record<PreWorkoutDecision, string> = {
  go: "text-teal",
  lighten: "text-warning",
  move: "text-blue",
  recover: "text-danger",
};

function dayLabel(day: string | null) {
  if (!day) return "geen actuele Garmin-meting";
  return new Date(`${day}T12:00:00`).toLocaleDateString("nl-BE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/Brussels",
  });
}

export function PreWorkoutCheckCard({
  check,
  session,
}: {
  check: PreWorkoutCheck;
  session: PlanSession;
}) {
  const router = useRouter();
  const visual = DECISION_STYLE[check.decision];
  const DecisionIcon = visual.icon;
  const jobType = `preworkout_review:${session.id}:${check.decision}`;
  const [state, setState] = React.useState<ReviewState>("idle");
  const [requestId, setRequestId] = React.useState<number | null>(null);
  const busy = state === "requested" || state === "running";

  React.useEffect(() => {
    if (check.decision === "go") return;
    let cancelled = false;
    createClient()
      .from("sync_log")
      .select("id, status, error")
      .eq("sync_type", jobType)
      .in("status", ["requested", "running"])
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setState(data.status === "running" ? "running" : "requested");
        setRequestId(data.id);
      });
    return () => {
      cancelled = true;
    };
  }, [check.decision, jobType]);

  React.useEffect(() => {
    if (requestId === null) return;
    const startedAt = Date.now();
    const sb = createClient();
    const timer = setInterval(async () => {
      const { data } = await sb
        .from("sync_log")
        .select("status, error")
        .eq("id", requestId)
        .maybeSingle();
      if (!data) return;
      if (data.status === "running") {
        setState("running");
        return;
      }
      if (data.status === "ok") {
        clearInterval(timer);
        setRequestId(null);
        setState("done");
        toast.success("Coachreview afgerond", {
          description: "Je trainingsadvies en planning zijn opnieuw beoordeeld.",
        });
        router.refresh();
        return;
      }
      if (data.status === "error") {
        clearInterval(timer);
        setRequestId(null);
        setState("error");
        toast.error("Coachreview niet afgerond", {
          description: data.error ?? "Probeer het later opnieuw.",
          duration: 6500,
        });
        return;
      }
      if (Date.now() - startedAt > WORKER_TIMEOUT_MS) {
        clearInterval(timer);
        setRequestId(null);
        setState("no_worker");
        toast.warning("Coachreview wacht", {
          description: "De aanvraag wordt verwerkt zodra de coachworker draait.",
          duration: 6500,
        });
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [requestId, router]);

  async function requestReview() {
    if (busy || check.decision === "go") return;
    setState("requested");
    const sb = createClient();
    const { data, error } = await sb
      .from("sync_log")
      .insert({ sync_type: jobType, status: "requested" })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        const { data: existing } = await sb
          .from("sync_log")
          .select("id, sync_type, status")
          .in("status", ["requested", "running"])
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existing?.sync_type === jobType) {
          setState(existing.status === "running" ? "running" : "requested");
          setRequestId(existing.id);
          return;
        }
        toast.warning("Coachreview niet gestart", {
          description: "Er loopt al een andere Garmin- of coachtaak. Probeer daarna opnieuw.",
          duration: 6500,
        });
      } else {
        toast.error("Coachreview niet gestart", {
          description: "De aanvraag kon niet worden opgeslagen. Probeer opnieuw.",
          duration: 6500,
        });
      }
      setState("error");
      return;
    }
    setRequestId(data.id);
  }

  const negativeSignals = check.signals.filter(
    (signal) => signal.tone === "watch" || signal.tone === "stop",
  );
  const orderedSignals = [
    ...negativeSignals,
    ...check.signals.filter((signal) => !negativeSignals.includes(signal)),
  ];

  return (
    <DetailDrawer
      title="Pre-workout check"
      subtitle={`Garmin en je recente trainingen · data van ${dayLabel(check.dataDay)}`}
      triggerClassName="focus-ring block w-full rounded-card text-left"
      trigger={
        <Card className={`surface-pressable border-line-strong p-4 ${visual.borderClass}`}>
          <div className="flex items-start gap-3.5">
            <div className={`grid size-10 shrink-0 place-items-center rounded-full ${visual.iconClass}`}>
              <DecisionIcon className="size-[18px]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="label mb-1.5">Pre-workout check</div>
              <div className="text-[16px] font-semibold text-ink">{check.title}</div>
              <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted">
                {check.summary}
              </p>
            </div>
            <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-faint" />
          </div>
        </Card>
      }
    >
      <div className="space-y-5 pt-3">
        <div className={`rounded-card border bg-canvas/25 p-4 ${visual.borderClass}`}>
          <div className="flex items-start gap-3">
            <div className={`grid size-9 shrink-0 place-items-center rounded-full ${visual.iconClass}`}>
              <DecisionIcon className="size-4" />
            </div>
            <div className="min-w-0">
              <div className={`text-[9px] font-bold uppercase tracking-[0.11em] ${DECISION_TEXT[check.decision]}`}>
                {visual.eyebrow}
              </div>
              <div className="mt-1 text-[17px] font-semibold tracking-[-0.02em] text-ink">
                {check.title}
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">{check.summary}</p>
            </div>
          </div>
        </div>

        <section aria-labelledby={`preworkout-signals-${session.id}`}>
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <h3 id={`preworkout-signals-${session.id}`} className="label">
              Signalen in deze beslissing
            </h3>
            <span className="text-[10px] font-semibold text-faint">
              {check.negativeSignalCount === 0
                ? "geen waarschuwingen"
                : `${check.negativeSignalCount} om op te letten`}
            </span>
          </div>
          <div className="overflow-hidden rounded-card border border-line">
            {orderedSignals.map((signal, index) => {
              const Icon = SIGNAL_ICON[signal.key];
              return (
                <div
                  key={signal.key}
                  className={`flex items-start gap-3 px-3.5 py-3 ${index ? "border-t border-line" : ""}`}
                >
                  <div className={`grid size-8 shrink-0 place-items-center rounded-full ${SIGNAL_STYLE[signal.tone]}`}>
                    <Icon className="size-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[12px] font-semibold text-ink">{signal.label}</span>
                      <span className="shrink-0 text-[11px] font-semibold text-muted">{signal.value}</span>
                    </div>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-faint">{signal.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div>
          <div className="label mb-2.5">Volgende stap</div>
          {check.decision === "go" ? (
            <Button asChild className="w-full" size="lg">
              <Link href={`/plan/${session.id}`}>
                Training bekijken <ArrowUpRight />
              </Link>
            </Button>
          ) : (
            <div className="space-y-2.5">
              <Button className="w-full" size="lg" onClick={requestReview} disabled={busy || state === "done"}>
                {busy ? (
                  <><LoaderCircle className="animate-spin" /> {state === "running" ? "Coach beoordeelt" : "Review aanvragen"}</>
                ) : state === "done" ? (
                  <><Check /> Voorstel staat klaar</>
                ) : (
                  <>Voorstel laten maken <ArrowUpRight /></>
                )}
              </Button>
              <Button asChild variant="secondary" className="w-full">
                <Link href={`/plan/${session.id}`}>Training zelf beheren</Link>
              </Button>
              <p className="px-2 text-center text-[10px] leading-relaxed text-faint">
                De coach synchroniseert eerst de nieuwste Garmin-data en maakt een voorstel. Je plan en horloge veranderen pas nadat jij dat voorstel goedkeurt.
              </p>
            </div>
          )}
        </div>
      </div>
    </DetailDrawer>
  );
}
