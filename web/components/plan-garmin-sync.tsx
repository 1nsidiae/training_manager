"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  LoaderCircle,
  RotateCcw,
  Send,
  Watch,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { createClient } from "@/lib/supabase/client";
import type { Plan, PlanSession, PlanSyncLog } from "@/lib/queries";

const SUPPORTED = new Set(["easy", "recovery", "long", "tempo", "interval", "walk_run", "race"]);
const POLL_MS = 1_500;
const TIMEOUT_MS = 90_000;

function todayInBrussels() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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

export function PlanGarminSync({
  plan,
  previousPlan,
  sessions,
  initialSync,
}: {
  plan: Plan;
  previousPlan: Plan | null;
  sessions: PlanSession[];
  initialSync: PlanSyncLog | null;
}) {
  const router = useRouter();
  const [state, setState] = React.useState<PlanSyncLog["status"] | "idle">(
    initialSync?.status ?? "idle",
  );
  const [requestId, setRequestId] = React.useState<number | null>(
    initialSync && ["requested", "running"].includes(initialSync.status) ? initialSync.id : null,
  );
  const [detail, setDetail] = React.useState<string | null>(initialSync?.error ?? null);
  const [restoreConfirm, setRestoreConfirm] = React.useState(false);
  const [restoring, setRestoring] = React.useState(false);
  const today = React.useMemo(todayInBrussels, []);
  const upcoming = sessions.filter(
    (session) =>
      session.day >= today &&
      session.sport === "running" &&
      SUPPORTED.has(session.session_type) &&
      ["planned", "moved"].includes(session.status),
  );
  const pushed = upcoming.filter((session) => Boolean(session.pushed_at) && !session.push_error).length;
  const failed = upcoming.filter((session) => Boolean(session.push_error)).length;
  const allPushed = upcoming.length > 0 && pushed === upcoming.length;
  const busy = state === "requested" || state === "running";
  const syncError = state === "error" || failed > 0;
  const canRestore = Boolean(previousPlan) && !sessions.some((session) => session.status === "completed");

  React.useEffect(() => {
    if (requestId === null) return;
    const started = Date.now();
    const sb = createClient();
    const timer = window.setInterval(async () => {
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
      if (data.status === "ok" || data.status === "error") {
        window.clearInterval(timer);
        setState(data.status);
        setDetail(data.error ?? null);
        setRequestId(null);
        if (data.status === "ok") {
          toast.success("Garmin-planning bijgewerkt", {
            description: "Je toekomstige loopsessies zijn opnieuw gesynchroniseerd.",
          });
        } else {
          toast.error("Garmin-planning niet volledig bijgewerkt", {
            description: data.error ?? "Bekijk de Garmin-status voor de resterende actie.",
            duration: 6500,
          });
        }
        router.refresh();
        return;
      }
      if (Date.now() - started > TIMEOUT_MS) {
        window.clearInterval(timer);
        setState("error");
        setDetail("De Garmin-taak staat klaar, maar de worker reageert nog niet.");
        setRequestId(null);
        toast.warning("Garmin-update wacht", {
          description: "De taak wordt verwerkt zodra de worker weer draait.",
          duration: 6500,
        });
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [requestId, router]);

  async function requestSync(targetPlan = plan, oldPlan = previousPlan) {
    setState("requested");
    setDetail(null);
    const job = `plan_apply:${targetPlan.id}:${oldPlan?.id ?? 0}`;
    const sb = createClient();
    const { data, error } = await sb
      .from("sync_log")
      .insert({ sync_type: job, status: "requested" })
      .select("id")
      .single();
    if (!error && data) {
      setRequestId(data.id);
      return;
    }
    if (error?.code === "23505") {
      const { data: active } = await sb
        .from("sync_log")
        .select("id, sync_type, status")
        .in("status", ["requested", "running"])
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (active?.sync_type === job) {
        setRequestId(active.id);
        setState(active.status);
        return;
      }
      setState("error");
      setDetail("Er loopt nog een andere Garmin-taak. Probeer opnieuw zodra die klaar is.");
      toast.warning("Andere Garmin-taak is bezig", {
        description: "Probeer opnieuw zodra die taak klaar is.",
      });
      return;
    }
    setState("error");
    setDetail("De Garmin-update kon niet worden aangevraagd.");
    toast.error("Garmin-update niet gestart", {
      description: "De aanvraag kon niet worden opgeslagen. Probeer opnieuw.",
      duration: 6500,
    });
  }

  async function restorePrevious() {
    if (!previousPlan || restoring) return;
    setRestoring(true);
    setDetail(null);
    const sb = createClient();
    const { error: demoteError } = await sb
      .from("plans")
      .update({ status: "superseded" })
      .eq("id", plan.id)
      .eq("status", "active");
    if (demoteError) {
      setDetail("Het huidige plan kon niet veilig worden bewaard.");
      toast.error("Vorig plan niet hersteld", {
        description: "Het huidige plan kon niet veilig worden bewaard.",
        duration: 6500,
      });
      setRestoring(false);
      return;
    }
    const { error: restoreError } = await sb
      .from("plans")
      .update({ status: "active" })
      .eq("id", previousPlan.id)
      .eq("status", "superseded");
    if (restoreError) {
      await sb.from("plans").update({ status: "active" }).eq("id", plan.id);
      setDetail("Het vorige plan kon niet worden hersteld. Het huidige blijft actief.");
      toast.error("Vorig plan niet hersteld", {
        description: "Je huidige plan blijft actief.",
        duration: 6500,
      });
      setRestoring(false);
      return;
    }

    const now = new Date().toISOString();
    await sb.from("sync_log").insert({
      sync_type: `plan_decision:${plan.id}:reverted`,
      status: "ok",
      started_at: now,
      finished_at: now,
      items_synced: 0,
    });
    await sb.from("sync_log").insert({
      sync_type: `plan_apply:${previousPlan.id}:${plan.id}`,
      status: "requested",
    });
    setRestoring(false);
    toast.success("Vorig plan hersteld", {
      description: "De bijbehorende Garmin-update staat in de wachtrij.",
    });
    router.refresh();
  }

  const tone = busy
    ? { icon: "bg-recovery/10 text-recovery", badge: "recovery" as const, label: "Wordt bijgewerkt" }
    : syncError
        ? { icon: "bg-danger/10 text-danger", badge: "danger" as const, label: "Actie nodig" }
      : allPushed
        ? { icon: "bg-teal/10 text-teal", badge: "teal" as const, label: "Op Garmin" }
        : { icon: "bg-s2 text-muted", badge: "outline" as const, label: "Klaar om te sturen" };

  return (
    <section>
      <div className="label mb-2">Garmin-status</div>
      <div className="rounded-[18px] border border-line bg-s2/45 p-3">
        <div className="flex items-center gap-3">
          <div className={`grid size-9 shrink-0 place-items-center rounded-full ${tone.icon}`}>
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : allPushed ? <Check className="size-4" /> : failed ? <AlertCircle className="size-4" /> : <Watch className="size-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-ink">
              {busy
                ? "Je Garmin-planning wordt bijgewerkt"
                : syncError
                  ? "De Garmin-update is niet volledig"
                  : allPushed
                    ? "Je schema staat op Garmin"
                    : "Je schema is klaar voor Garmin"}
            </div>
            <p className="mt-0.5 text-[10px] text-faint">
              {pushed} van {upcoming.length} toekomstige loopsessies gesynchroniseerd
            </p>
          </div>
          <Badge variant={tone.badge}>{tone.label}</Badge>
        </div>

        {upcoming.length ? (
          <div className="mt-3 divide-y divide-line border-t border-line">
            {upcoming.map((session) => {
              const sessionFailed = Boolean(session.push_error);
              const complete = Boolean(session.pushed_at) && !sessionFailed;
              return (
                <div key={session.id} className="flex items-center gap-3 py-2.5">
                  <span className={`size-1.5 rounded-full ${complete ? "bg-teal" : sessionFailed ? "bg-danger" : busy ? "bg-recovery" : "bg-faint"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-semibold text-ink">{session.title}</div>
                    <div className="mt-0.5 text-[9px] capitalize text-faint">{compactDay(session.day)}</div>
                  </div>
                  <span className={`text-[9px] font-bold uppercase tracking-[0.06em] ${complete ? "text-teal" : sessionFailed ? "text-danger" : busy ? "text-recovery" : "text-faint"}`}>
                    {complete ? "Op Garmin" : sessionFailed ? "Mislukt" : busy ? "In wachtrij" : "Klaar"}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 border-t border-line pt-3 text-[10px] leading-relaxed text-faint">
            Er staan geen toekomstige gestructureerde loopsessies in dit plan.
          </p>
        )}

        {detail ? <p className="mt-2 text-[10px] leading-relaxed text-danger" role="alert">{detail}</p> : null}

        {(!allPushed || syncError) && upcoming.length ? (
          <Button variant="metric" size="sm" className="mt-3 w-full" onClick={() => requestSync()} disabled={busy}>
            {busy ? <LoaderCircle className="animate-spin" /> : <Send />}
            {state === "error" || failed ? "Garmin opnieuw bijwerken" : "Garmin bijwerken"}
          </Button>
        ) : null}
      </div>

      {canRestore && !busy ? (
        <div className="mt-3">
          {restoreConfirm ? (
            <div className="rounded-[16px] border border-warning/20 bg-warning/5 p-3">
              <p className="text-[10px] leading-relaxed text-muted">
                Plan v{previousPlan!.version} wordt opnieuw actief. De Garmin-kalender wordt daarna teruggezet.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="secondary" size="sm" onClick={() => setRestoreConfirm(false)} disabled={restoring}>Annuleren</Button>
                <Button size="sm" onClick={restorePrevious} disabled={restoring}>
                  {restoring ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}
                  Herstellen
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" size="sm" className="w-full text-faint" onClick={() => setRestoreConfirm(true)}>
              <RotateCcw /> Vorig plan herstellen
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}
