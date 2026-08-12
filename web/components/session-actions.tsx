"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarDays, Check, ChevronLeft, LoaderCircle, MoreHorizontal, RotateCcw, SkipForward } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { createClient } from "@/lib/supabase/client";
import type { PlanSession } from "@/lib/queries";

const STATUS = {
  planned: { label: "Gepland", variant: "outline" as const },
  completed: { label: "Voltooid", variant: "teal" as const },
  skipped: { label: "Overgeslagen", variant: "warning" as const },
  moved: { label: "Verplaatst", variant: "recovery" as const },
};

export function SessionStatusBadge({ status }: { status: string }) {
  const meta = STATUS[status as keyof typeof STATUS] ?? STATUS.planned;
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

export function SessionActions({ session }: { session: PlanSession }) {
  const router = useRouter();
  const sessionDate = React.useMemo(() => new Date(`${session.day}T12:00:00`), [session.day]);
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<"menu" | "move">("menu");
  const [date, setDate] = React.useState<Date | undefined>(sessionDate);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const today = React.useMemo(() => {
    const iso = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Brussels",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    return new Date(`${iso}T12:00:00`);
  }, []);

  async function updateSession(values: { status: string; day?: string }) {
    setSaving(true);
    setError(null);
    const sb = createClient();
    const movedOnGarmin =
      Boolean(session.garmin_workout_id) && Boolean(values.day) && values.day !== session.day;
    const removeFromGarmin =
      Boolean(session.garmin_schedule_id) && values.status === "skipped";
    const restoreOnGarmin =
      Boolean(session.garmin_workout_id) &&
      session.status === "skipped" &&
      values.status === "planned";
    const garminJob = removeFromGarmin
      ? `workout_unschedule:${session.id}`
      : movedOnGarmin || restoreOnGarmin
        ? `workout_reschedule:${session.id}`
        : null;
    const updateValues: {
      status: string;
      day?: string;
      pushed_at?: null;
      push_error?: null;
    } = { ...values };
    if (garminJob) {
      updateValues.pushed_at = null;
      updateValues.push_error = null;
    }

    const { error: updateError } = await sb
      .from("plan_sessions")
      .update(updateValues)
      .eq("id", session.id);

    if (updateError) {
      setError("De training kon niet worden bijgewerkt. Probeer opnieuw.");
      setSaving(false);
      return;
    }

    if (garminJob) {
      const { error: jobError } = await sb
        .from("sync_log")
        .insert({ sync_type: garminJob, status: "requested" });
      if (jobError) {
        if (jobError.code === "23505") {
          const { data: existing } = await sb
            .from("sync_log")
            .select("sync_type")
            .in("status", ["requested", "running"])
            .order("id", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (existing?.sync_type === garminJob) {
            setSaving(false);
            setOpen(false);
            setMode("menu");
            router.refresh();
            return;
          }
        }
        setError(
          "De planning is in de app aangepast, maar Garmin wacht nog. Probeer opnieuw zodra de andere Garmin-taak klaar is.",
        );
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    setOpen(false);
    setMode("menu");
    router.refresh();
  }

  function moveSession() {
    if (!date) return;
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Brussels",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
    updateSession({ status: day === session.day ? "planned" : "moved", day });
  }

  function formatMoveDate(value: Date | undefined, includeYear = false) {
    if (!value) return "Kies een dag";
    return new Intl.DateTimeFormat("nl-BE", {
      timeZone: "Europe/Brussels",
      weekday: "short",
      day: "numeric",
      month: "short",
      ...(includeYear ? { year: "numeric" as const } : {}),
    })
      .format(value)
      .replaceAll(".", "");
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setMode("menu");
          setDate(sessionDate);
        }
      }}
    >
      <DrawerTrigger asChild>
        <Button variant="secondary" className="w-full justify-between px-3.5">
          <span className="flex items-center gap-2">
            <MoreHorizontal /> Training beheren
          </span>
          <SessionStatusBadge status={session.status} />
        </Button>
      </DrawerTrigger>
      <DrawerContent className={mode === "move" ? "max-h-[88dvh]" : undefined}>
        {mode === "move" ? (
          <div className="flex items-start gap-3 border-b border-line px-4 pb-4 pt-3">
            <Button
              variant="icon"
              size="icon"
              className="size-9 min-h-9 shrink-0 bg-s2/60"
              onClick={() => setMode("menu")}
              disabled={saving}
              aria-label="Terug naar training beheren"
            >
              <ChevronLeft />
            </Button>
            <div className="min-w-0 pt-0.5">
              <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-recovery">
                Planning aanpassen
              </div>
              <DrawerTitle className="mt-1 text-[18px] font-semibold tracking-[-0.025em]">
                Training verplaatsen
              </DrawerTitle>
              <DrawerDescription className="mt-1 text-[11px] leading-relaxed text-faint">
                Kies een nieuwe dag voor {session.title.toLowerCase()}.
              </DrawerDescription>
            </div>
          </div>
        ) : (
          <div className="border-b border-line px-4 pb-3 pt-3">
            <DrawerTitle className="text-[17px] font-semibold tracking-[-0.02em]">
              Training beheren
            </DrawerTitle>
            <DrawerDescription className="mt-1 text-[11px] text-faint">
              {session.title}
            </DrawerDescription>
          </div>
        )}

        <div className="overflow-y-auto px-4 pb-6 pt-4">
          {mode === "move" ? (
            <>
              <div className="mb-3 grid grid-cols-[1fr_auto_1fr] items-center rounded-[18px] border border-line bg-canvas/35 px-3 py-2.5">
                <div>
                  <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-faint">Nu</div>
                  <div className="mt-0.5 text-[11px] font-semibold capitalize text-muted">
                    {formatMoveDate(sessionDate)}
                  </div>
                </div>
                <span className="grid size-7 place-items-center rounded-full border border-line bg-s2 text-faint" aria-hidden>
                  <ArrowRight className="size-3.5" />
                </span>
                <div className="text-right">
                  <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-recovery">Nieuw</div>
                  <div className="mt-0.5 text-[11px] font-semibold capitalize text-ink">
                    {formatMoveDate(date)}
                  </div>
                </div>
              </div>

              <div className="mx-auto w-full rounded-[20px] border border-line bg-s2/30 p-1">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  disabled={{ before: today }}
                  modifiers={{ original: sessionDate }}
                  modifiersClassNames={{
                    original: "[&_button]:ring-1 [&_button]:ring-inset [&_button]:ring-line-strong",
                  }}
                  weekStartsOn={1}
                  timeZone="Europe/Brussels"
                  className="mx-auto [--cell-size:2.45rem] min-[390px]:[--cell-size:2.65rem]"
                  autoFocus
                />
              </div>

              <div className="mt-3 flex items-center justify-between px-1 text-[9px] text-faint">
                <span>Omcirkeld = huidige trainingsdag</span>
                <span className="font-semibold capitalize text-muted">{formatMoveDate(date, true)}</span>
              </div>

              <div className="mt-4">
                <Button className="w-full" size="lg" onClick={moveSession} disabled={!date || saving}>
                  {saving ? <LoaderCircle className="animate-spin" /> : <CalendarDays />}
                  {date?.toDateString() === sessionDate.toDateString() ? "Datum behouden" : "Training verplaatsen"}
                </Button>
              </div>
            </>
          ) : session.status === "completed" ? (
            <div className="rounded-card border border-teal/25 bg-teal/10 p-4 text-center">
              <Check className="mx-auto size-5 text-teal" />
              <div className="mt-2 text-[13px] font-semibold text-ink">Training voltooid</div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted">
                Deze sessie is gekoppeld aan je Garmin-activiteit en telt mee in je voortgang.
              </p>
            </div>
          ) : session.status === "skipped" ? (
            <>
              <div className="rounded-card border border-warning/25 bg-warning/10 p-4">
                <div className="text-[13px] font-semibold text-warning">Training overgeslagen</div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  Ze telt niet als voltooid. Je kunt haar opnieuw activeren en daarna eventueel verplaatsen.
                </p>
              </div>
              <Button className="mt-3 w-full" onClick={() => updateSession({ status: "planned" })} disabled={saving}>
                {saving ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}
                Opnieuw inplannen
              </Button>
            </>
          ) : (
            <div className="space-y-2">
              <button
                type="button"
                className="focus-ring surface-pressable flex w-full items-center gap-3 rounded-card border border-line bg-s1 p-3.5 text-left"
                onClick={() => setMode("move")}
              >
                <span className="grid size-9 place-items-center rounded-full bg-recovery/10 text-recovery">
                  <CalendarDays className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-ink">Verplaatsen</span>
                  <span className="mt-0.5 block text-[10px] text-faint">Kies een andere trainingsdag</span>
                </span>
              </button>
              <button
                type="button"
                className="focus-ring surface-pressable flex w-full items-center gap-3 rounded-card border border-line bg-s1 p-3.5 text-left"
                onClick={() => updateSession({ status: "skipped" })}
                disabled={saving}
              >
                <span className="grid size-9 place-items-center rounded-full bg-warning/10 text-warning">
                  {saving ? <LoaderCircle className="size-4 animate-spin" /> : <SkipForward className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-ink">Overslaan</span>
                  <span className="mt-0.5 block text-[10px] text-faint">Markeer als niet uitgevoerd</span>
                </span>
              </button>
            </div>
          )}

          {error ? <p className="mt-3 text-[11px] text-danger" role="alert">{error}</p> : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
