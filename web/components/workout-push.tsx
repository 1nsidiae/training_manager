"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRightLeft, CalendarCheck, Check, LoaderCircle, Send, Watch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import type { PlanSession, WorkoutConflict } from "@/lib/queries";

const WORKER_TIMEOUT_MS = 45_000;
const POLL_MS = 2_000;

type State = "idle" | "requested" | "running" | "done" | "error" | "no_worker";

function pushedLabel(value: string) {
  return new Date(value).toLocaleString("nl-BE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });
}

function dayLabel(day: string) {
  return new Date(`${day}T12:00:00`).toLocaleDateString("nl-BE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/Brussels",
  });
}

export function WorkoutPush({
  session,
  conflict,
}: {
  session: PlanSession;
  conflict: WorkoutConflict | null;
}) {
  const router = useRouter();
  const jobType = `workout_push:${session.id}`;
  const supported =
    session.sport === "running" &&
    ["planned", "moved"].includes(session.status) &&
    ["easy", "recovery", "long", "tempo", "interval", "walk_run", "race"].includes(
      session.session_type,
    );
  const [state, setState] = React.useState<State>("idle");
  const [requestId, setRequestId] = React.useState<number | null>(null);
  const [detail, setDetail] = React.useState<string | null>(session.push_error);
  const busy = state === "requested" || state === "running";
  const acceptGarminJob = conflict
    ? `workout_accept_garmin:${session.id}:${conflict.garmin_day ?? "removed"}:${
        conflict.garmin_schedule_id ?? ""
      }`
    : null;
  const activeJobTypes = [
    jobType,
    `workout_reschedule:${session.id}`,
    `workout_unschedule:${session.id}`,
    ...(acceptGarminJob ? [acceptGarminJob] : []),
  ];

  React.useEffect(() => {
    let cancelled = false;
    createClient()
      .from("sync_log")
      .select("id, status")
      .in("sync_type", activeJobTypes)
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
  }, [acceptGarminJob, jobType]);

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
        setDetail(null);
        setState("done");
        router.refresh();
        return;
      }
      if (data.status === "error") {
        clearInterval(timer);
        setRequestId(null);
        setDetail(data.error ?? "Garmin heeft de workout niet aanvaard.");
        setState("error");
        router.refresh();
        return;
      }
      if (Date.now() - startedAt > WORKER_TIMEOUT_MS) {
        clearInterval(timer);
        setRequestId(null);
        setState("no_worker");
        setDetail("De aanvraag staat klaar, maar de worker reageert nog niet.");
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [requestId, router]);

  async function requestJob(nextJob: string) {
    if (busy || !supported) return;
    setState("requested");
    setDetail(null);
    const sb = createClient();
    const { data, error } = await sb
      .from("sync_log")
      .insert({ sync_type: nextJob, status: "requested" })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        const { data: existing } = await sb
          .from("sync_log")
          .select("id, sync_type")
          .in("status", ["requested", "running"])
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existing?.sync_type === nextJob) {
          setRequestId(existing.id);
          return;
        }
        setState("error");
        setDetail("Wacht tot de andere Garmin-taak klaar is en probeer opnieuw.");
        return;
      }
      setState("error");
      setDetail("De exportaanvraag kon niet worden opgeslagen.");
      return;
    }
    setRequestId(data.id);
  }

  const complete = Boolean(session.pushed_at) || state === "done";
  const failed = state === "error" || state === "no_worker" || Boolean(detail);

  if (conflict) {
    const removed = conflict.garmin_day === null;
    return (
      <Card className="overflow-hidden border-warning/30">
        <div className="flex items-start gap-3 px-3.5 py-3.5">
          <div className="grid size-10 shrink-0 place-items-center rounded-full bg-warning/10 text-warning">
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRightLeft className="size-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-warning">
              Kalender wijkt af
            </div>
            <div className="mt-1 text-[13px] font-semibold text-ink">
              {removed ? "Niet meer gepland in Garmin" : "Andere dag in Garmin"}
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-muted">
              {removed
                ? `De PWA verwacht deze training op ${dayLabel(conflict.pwa_day)}, maar Garmin heeft ze uit de kalender gehaald.`
                : `PWA: ${dayLabel(conflict.pwa_day)} · Garmin: ${dayLabel(conflict.garmin_day!)}`}
            </p>
          </div>
        </div>
        {detail ? (
          <p className="border-t border-line px-3.5 py-2.5 text-[10px] text-danger" role="alert">
            {detail}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-2 border-t border-line p-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => requestJob(`workout_reschedule:${session.id}`)}
            disabled={busy}
          >
            PWA behouden
          </Button>
          <Button
            type="button"
            variant="metric"
            size="sm"
            onClick={() => acceptGarminJob && requestJob(acceptGarminJob)}
            disabled={busy || !acceptGarminJob}
          >
            {removed ? "Niet plannen" : "Garmin behouden"}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className={`overflow-hidden ${complete ? "border-teal/25" : failed ? "border-danger/25" : ""}`}>
      <div className="flex items-center gap-3 px-3.5 py-3.5">
        <div
          className={`grid size-10 shrink-0 place-items-center rounded-full ${
            complete
              ? "bg-teal/10 text-teal"
              : failed
                ? "bg-danger/10 text-danger"
                : "bg-recovery/10 text-recovery"
          }`}
        >
          {busy ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : failed ? (
            <AlertCircle className="size-4" />
          ) : complete ? (
            <Check className="size-4" />
          ) : (
            <Watch className="size-4" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-ink">
            {complete
              ? "Klaar op je Forerunner 965"
              : busy
                ? state === "running"
                  ? "Naar Garmin sturen…"
                  : "Export staat in de wachtrij…"
                : "Naar je Forerunner 965"}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-faint">
            <CalendarCheck className="size-3" aria-hidden />
            <span>
              {complete && session.pushed_at
                ? `${session.day} · verstuurd ${pushedLabel(session.pushed_at)}`
                : `Wordt gepland voor ${session.day}`}
            </span>
          </div>
        </div>

        {complete ? <Badge variant="teal">Op Garmin</Badge> : null}
      </div>

      {detail ? (
        <p className="border-t border-line px-3.5 py-2.5 text-[10px] leading-relaxed text-danger" role="alert">
          {detail}
        </p>
      ) : null}

      {!supported ? (
        <p className="border-t border-line px-3.5 py-2.5 text-[10px] text-faint">
          Export is voorlopig beschikbaar voor gestructureerde loopsessies.
        </p>
      ) : (
        <div className="border-t border-line px-3 py-2.5">
          <Button
            type="button"
            variant={complete ? "secondary" : "metric"}
            size="sm"
            className="w-full"
            onClick={() => requestJob(jobType)}
            disabled={busy}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : complete ? <Send /> : <Watch />}
            {busy ? "Even wachten" : complete ? "Opnieuw sturen" : "Stuur naar Garmin"}
          </Button>
        </div>
      )}
    </Card>
  );
}
