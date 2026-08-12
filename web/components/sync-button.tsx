"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createClient } from "@/lib/supabase/client";

const WORKER_TIMEOUT_MS = 45_000;
const POLL_MS = 2_000;

type State = "idle" | "requested" | "running" | "done" | "error" | "no_worker";

function syncDate(value?: string | null) {
  if (!value) return { date: "Nog niet bijgewerkt", time: "–" };
  const date = new Date(value);
  return {
    date: date.toLocaleDateString("nl-BE", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "Europe/Brussels",
    }).replaceAll(".", ""),
    time: date.toLocaleTimeString("nl-BE", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Brussels",
    }),
  };
}

const MESSAGE: Record<State, string> = {
  idle: "Garmin-gegevens zijn bijgewerkt",
  requested: "Sync staat in de wachtrij",
  running: "Gegevens ophalen bij Garmin",
  done: "Garmin-gegevens bijgewerkt",
  error: "De laatste sync is mislukt",
  no_worker: "De sync wacht op de worker",
};

export function SyncButton({ lastSyncAt }: { lastSyncAt?: string | null }) {
  const router = useRouter();
  const [state, setState] = React.useState<State>("idle");
  const [detail, setDetail] = React.useState<string | null>(null);
  const [requestId, setRequestId] = React.useState<number | null>(null);
  const busy = state === "requested" || state === "running";
  const failed = state === "error" || state === "no_worker";
  const synced = syncDate(lastSyncAt);

  React.useEffect(() => {
    let cancelled = false;
    createClient()
      .from("sync_log")
      .select("id, status")
      .eq("sync_type", "manual")
      .in("status", ["requested", "running"])
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setState(data.status === "running" ? "running" : "requested");
        setRequestId(data.id);
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    if (requestId === null) return;
    const startedAt = Date.now();
    const sb = createClient();
    const timer = window.setInterval(async () => {
      const { data } = await sb
        .from("sync_log")
        .select("status, items_synced, error")
        .eq("id", requestId)
        .maybeSingle();
      if (!data) return;
      if (data.status === "running") {
        setState("running");
        return;
      }
      if (data.status === "ok") {
        window.clearInterval(timer);
        setRequestId(null);
        setState("done");
        setDetail(`${data.items_synced ?? 0} records bijgewerkt`);
        router.refresh();
        window.setTimeout(() => setState("idle"), 4_000);
        return;
      }
      if (data.status === "error") {
        window.clearInterval(timer);
        setRequestId(null);
        setState("error");
        setDetail(data.error ?? null);
        return;
      }
      if (Date.now() - startedAt > WORKER_TIMEOUT_MS) {
        window.clearInterval(timer);
        setRequestId(null);
        setState("no_worker");
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [requestId, router]);

  async function request() {
    if (busy) return;
    setState("requested");
    setDetail(null);
    const sb = createClient();
    const { data, error } = await sb
      .from("sync_log")
      .insert({ sync_type: "manual", status: "requested" })
      .select("id")
      .single();
    if (!error && data) {
      setRequestId(data.id);
      return;
    }
    // De unieke index geldt voor de hele wachtrij, dus een 23505 kan net zo goed
    // een workout-push zijn. Alleen een eigen wachtende aanvraag adopteren we;
    // anders zouden we het resultaat van andermans taak melden als sync.
    if (error?.code === "23505") {
      const { data: existing } = await sb
        .from("sync_log")
        .select("id")
        .eq("sync_type", "manual")
        .in("status", ["requested", "running"])
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing) {
        setRequestId(existing.id);
        return;
      }
      setState("error");
      setDetail("Wacht tot de andere Garmin-taak klaar is en probeer opnieuw.");
      return;
    }
    setState("error");
    setDetail("De sync kon niet worden aangevraagd.");
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="focus-ring group flex h-11 w-[52px] flex-col items-end justify-center rounded-xl px-1 transition-colors hover:bg-s2/60"
          aria-label={`Laatste Garmin-sync: ${synced.date} om ${synced.time}`}
        >
          <span className="relative mr-0.5">
            {state === "done" ? (
              <Check className="size-3.5 text-teal" />
            ) : failed ? (
              <AlertCircle className="size-3.5 text-warning" />
            ) : (
              <RefreshCw className={`size-3.5 ${busy ? "animate-spin text-teal" : "text-faint group-hover:text-muted"}`} />
            )}
            {!failed && !busy ? <span className="absolute -right-1 -top-0.5 size-1.5 rounded-full bg-teal ring-2 ring-base" /> : null}
          </span>
          <span className={`numeral mt-1 text-[9px] ${failed ? "text-warning" : "text-muted"}`}>
            {busy ? "SYNC" : synced.time}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} collisionPadding={12} className="w-[260px] p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="label">Laatste Garmin-sync</div>
            <div className="mt-1.5 text-[14px] font-semibold capitalize text-ink">
              {synced.date} · {synced.time}
            </div>
          </div>
          <Badge variant={failed ? "warning" : busy ? "recovery" : "teal"}>
            {failed ? "Actie nodig" : busy ? "Bezig" : "Bijgewerkt"}
          </Badge>
        </div>
        <p className={`mt-2 text-[10px] leading-relaxed ${failed ? "text-warning" : "text-muted"}`}>
          {detail || MESSAGE[state]}
        </p>
        {state === "no_worker" ? (
          <p className="mt-1 text-[9px] leading-relaxed text-faint">
            De aanvraag blijft bewaard en wordt verwerkt zodra de worker draait.
          </p>
        ) : null}
        <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={request} disabled={busy}>
          <RefreshCw className={busy ? "animate-spin" : undefined} />
          {busy ? "Synchroniseren" : "Nu synchroniseren"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
