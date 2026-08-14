"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  CircleGauge,
  Flag,
  LoaderCircle,
  Mountain,
  Plus,
  RefreshCw,
  Route,
  Sparkles,
  TimerReset,
} from "lucide-react";
import { requestNewPlan, type NewPlanRequest } from "@/app/(app)/plan/actions";
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
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type GoalType = NewPlanRequest["goalType"];
type Weekday = NewPlanRequest["trainingDays"][number];
type RequestState = "idle" | "requested" | "running" | "done" | "error";

const GOALS: Array<{
  value: GoalType;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: "race", title: "Wedstrijd", description: "Pieken op een vaste racedatum", icon: Flag },
  { value: "time_target", title: "Tijddoel", description: "Bijvoorbeeld sub-20 op 5 km", icon: TimerReset },
  { value: "maintenance", title: "Conditie opbouwen", description: "Sterker worden zonder racedatum", icon: Mountain },
  { value: "return_to_run", title: "Terug naar lopen", description: "Verantwoord hervatten na een pauze", icon: RefreshCw },
];

const DISTANCES = [
  { label: "5 km", value: 5_000 },
  { label: "10 km", value: 10_000 },
  { label: "Halve", value: 21_097.5 },
  { label: "Marathon", value: 42_195 },
] as const;

const DAYS: Array<{ value: Weekday; short: string; label: string; weekend: boolean }> = [
  { value: "monday", short: "Ma", label: "maandag", weekend: false },
  { value: "tuesday", short: "Di", label: "dinsdag", weekend: false },
  { value: "wednesday", short: "Wo", label: "woensdag", weekend: false },
  { value: "thursday", short: "Do", label: "donderdag", weekend: false },
  { value: "friday", short: "Vr", label: "vrijdag", weekend: false },
  { value: "saturday", short: "Za", label: "zaterdag", weekend: true },
  { value: "sunday", short: "Zo", label: "zondag", weekend: true },
];

const AMBITIONS = [
  { value: "conservative" as const, label: "Behoudend", description: "Extra marge voor herstel" },
  { value: "balanced" as const, label: "Gebalanceerd", description: "Uitdagend maar duurzaam" },
  { value: "ambitious" as const, label: "Ambitieus", description: "Sneller opbouwen binnen de regels" },
];

type WizardData = {
  goalType: GoalType | null;
  targetDistanceM: number | null;
  customDistanceKm: string;
  targetDate: string | null;
  targetTime: string;
  planStartDate: string;
  firstTrainingDate: string;
  currentCapacityKm: string;
  currentWeeklyVolumeKm: string;
  benchmarkDistanceKm: string;
  benchmarkTime: string;
  sessionsPerWeek: number;
  trainingDays: Weekday[];
  longRunDay: Weekday | null;
  maxWeekdayMinutes: string;
  maxWeekendMinutes: string;
  ambition: NewPlanRequest["ambition"];
  limitations: string;
};

function parseClock(value: string): number | null {
  const parts = value.trim().split(":").map(Number);
  if (!value.trim() || parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return seconds >= 0 && seconds < 60 && minutes >= 0 ? minutes * 60 + seconds : null;
  }
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return minutes >= 0 && minutes < 60 && seconds >= 0 && seconds < 60 && hours >= 0
      ? hours * 3600 + minutes * 60 + seconds
      : null;
  }
  return null;
}

function formatDate(iso: string | null) {
  if (!iso) return "Kies een datum";
  return new Intl.DateTimeFormat("nl-BE", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    .format(new Date(`${iso}T12:00:00`));
}

function dateToIso(value: Date | undefined) {
  if (!value) return null;
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfToday() {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  return value;
}

function weekdayFromIso(iso: string): Weekday {
  const index = new Date(`${iso}T12:00:00`).getDay();
  return (["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as Weekday[])[index];
}

function firstAvailableDate(startIso: string, availableDays: Weekday[]) {
  const date = new Date(`${startIso}T12:00:00`);
  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = new Date(date);
    candidate.setDate(candidate.getDate() + offset);
    const iso = dateToIso(candidate)!;
    if (availableDays.includes(weekdayFromIso(iso))) return iso;
  }
  return startIso;
}

function distanceName(distanceM: number | null) {
  if (!distanceM) return "Geen vaste afstand";
  const preset = DISTANCES.find((distance) => Math.abs(distance.value - distanceM) < 2);
  return preset?.label ?? `${(distanceM / 1000).toLocaleString("nl-BE", { maximumFractionDigits: 1 })} km`;
}

function dayName(day: Weekday | null) {
  return DAYS.find((item) => item.value === day)?.label ?? "Coach kiest";
}

function Choice({
  active,
  title,
  description,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-20 w-full items-center gap-3 rounded-[16px] border p-3 text-left transition-colors active:bg-s3",
        active ? "border-recovery/55 bg-recovery/10" : "border-line bg-s2/55",
      )}
    >
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-full", active ? "bg-recovery/15 text-recovery" : "bg-s3 text-faint")}>
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-[10px] leading-relaxed text-muted">{description}</span>
      </span>
      {active ? <Check className="size-4 shrink-0 text-recovery" /> : <ChevronRight className="size-4 shrink-0 text-faint" />}
    </button>
  );
}

export function NewPlanWizard({
  defaultCapacityM = 5_000,
  defaultWeeklyVolumeM = 0,
  defaultBenchmark,
  initialRequest,
}: {
  defaultCapacityM?: number;
  defaultWeeklyVolumeM?: number;
  defaultBenchmark?: { distanceM: number; durationS: number } | null;
  initialRequest?: { id: number; status: "requested" | "running" | "ok" | "error"; error: string | null } | null;
}) {
  const defaultTrainingDays: Weekday[] = ["tuesday", "thursday", "sunday"];
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState(0);
  const [requestState, setRequestState] = React.useState<RequestState>(
    initialRequest?.status === "ok" ? "done" : initialRequest?.status ?? "idle",
  );
  const [requestError, setRequestError] = React.useState(initialRequest?.error ?? "");
  const [requestId, setRequestId] = React.useState<number | null>(initialRequest?.id ?? null);
  const [submitting, setSubmitting] = React.useState(false);
  const [data, setData] = React.useState<WizardData>(() => {
    const planStartDate = dateToIso(new Date())!;
    return {
      goalType: null,
      targetDistanceM: 5_000,
      customDistanceKm: "",
      targetDate: null,
      targetTime: "20:00",
      planStartDate,
      firstTrainingDate: firstAvailableDate(planStartDate, defaultTrainingDays),
      currentCapacityKm: String(Math.round((defaultCapacityM / 1000) * 10) / 10),
      currentWeeklyVolumeKm: String(Math.round((defaultWeeklyVolumeM / 1000) * 10) / 10),
      benchmarkDistanceKm: defaultBenchmark ? String(Math.round((defaultBenchmark.distanceM / 1000) * 10) / 10) : "",
      benchmarkTime: defaultBenchmark ? `${Math.floor(defaultBenchmark.durationS / 60)}:${String(defaultBenchmark.durationS % 60).padStart(2, "0")}` : "",
      sessionsPerWeek: 3,
      trainingDays: defaultTrainingDays,
      longRunDay: "sunday",
      maxWeekdayMinutes: "60",
      maxWeekendMinutes: "120",
      ambition: "balanced",
      limitations: "",
    };
  });

  const selectedDistance = data.customDistanceKm
    ? Number(data.customDistanceKm.replace(",", ".")) * 1000
    : data.targetDistanceM;
  const needsGoalDetails = data.goalType === "race" || data.goalType === "time_target";
  const steps = needsGoalDetails ? 6 : 5;
  const visualStep = step;
  const baselineStep = needsGoalDetails ? 2 : 1;
  const planStartStep = needsGoalDetails ? 3 : 2;
  const availabilityStep = needsGoalDetails ? 4 : 3;
  const reviewStep = needsGoalDetails ? 5 : 4;

  React.useEffect(() => {
    if (!requestId || (requestState !== "requested" && requestState !== "running")) return;
    const sb = createClient();
    const started = Date.now();
    const timer = window.setInterval(async () => {
      const { data: row } = await sb.from("sync_log").select("status, error").eq("id", requestId).maybeSingle();
      if (!row) return;
      if (row.status === "ok") {
        window.clearInterval(timer);
        setRequestState("done");
        router.refresh();
      } else if (row.status === "error" || Date.now() - started > 15 * 60_000) {
        window.clearInterval(timer);
        setRequestState("error");
        setRequestError(row.error ?? "De coachanalyse duurt abnormaal lang. Controleer de worker.");
      } else if (row.status === "running") {
        setRequestState("running");
      }
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [requestId, requestState, router]);

  function update(patch: Partial<WizardData>) {
    setData((current) => ({ ...current, ...patch }));
  }

  function currentValidation() {
    if (step === 0 && !data.goalType) return "Kies eerst welk doel je wilt bereiken.";
    if (step === 1 && needsGoalDetails) {
      if (!selectedDistance || selectedDistance < 1_000) return "Kies een doelafstand van minstens 1 km.";
      if (data.goalType === "race" && !data.targetDate) return "Kies de datum van je wedstrijd.";
      if (data.goalType === "time_target" && !parseClock(data.targetTime)) return "Vul je doeltijd in als mm:ss of uu:mm:ss.";
    }
    if (step === baselineStep) {
      if (!Number.isFinite(Number(data.currentCapacityKm)) || Number(data.currentCapacityKm) < 0) return "Vul je huidige aaneengesloten loopafstand in.";
      if (!Number.isFinite(Number(data.currentWeeklyVolumeKm)) || Number(data.currentWeeklyVolumeKm) < 0) return "Vul je huidige weekvolume in.";
      if ((data.benchmarkDistanceKm && !data.benchmarkTime) || (!data.benchmarkDistanceKm && data.benchmarkTime)) return "Vul voor je recente prestatie zowel afstand als tijd in, of laat beide leeg.";
      if (data.benchmarkTime && !parseClock(data.benchmarkTime)) return "Vul de recente tijd in als mm:ss of uu:mm:ss.";
    }
    if (step === planStartStep) {
      if (!data.planStartDate || !data.firstTrainingDate) return "Kies wanneer je plan en je eerste training beginnen.";
      if (data.firstTrainingDate < data.planStartDate) return "Je eerste training kan niet vóór de start van je plan vallen.";
      if (data.targetDate && data.firstTrainingDate >= data.targetDate) return "Je eerste training moet vóór je doeldatum vallen.";
    }
    if (step === availabilityStep && data.trainingDays.length < data.sessionsPerWeek) {
      return `Kies minstens ${data.sessionsPerWeek} beschikbare dagen.`;
    }
    if (step === availabilityStep && !data.trainingDays.includes(weekdayFromIso(data.firstTrainingDate))) {
      return "De gekozen eerste trainingsdag moet ook bij je beschikbare dagen staan.";
    }
    return null;
  }

  function next() {
    const message = currentValidation();
    if (message) {
      toast.warning("Nog een keuze nodig", { description: message });
      return;
    }
    setStep((current) => Math.min(current + 1, steps - 1));
  }

  function previous() {
    setStep((current) => Math.max(0, current - 1));
  }

  function toggleDay(day: Weekday) {
    const nextDays = data.trainingDays.includes(day)
      ? data.trainingDays.filter((item) => item !== day)
      : [...data.trainingDays, day];
    update({
      trainingDays: nextDays,
      longRunDay: data.longRunDay === day && !nextDays.includes(day) ? null : data.longRunDay,
    });
  }

  function selectPlanStart(date: Date | undefined) {
    const planStartDate = dateToIso(date);
    if (!planStartDate) return;
    update({
      planStartDate,
      firstTrainingDate: data.firstTrainingDate < planStartDate
        ? firstAvailableDate(planStartDate, data.trainingDays)
        : data.firstTrainingDate,
    });
  }

  function selectFirstTraining(date: Date | undefined) {
    const firstTrainingDate = dateToIso(date);
    if (!firstTrainingDate) return;
    const firstDay = weekdayFromIso(firstTrainingDate);
    update({
      firstTrainingDate,
      trainingDays: data.trainingDays.includes(firstDay)
        ? data.trainingDays
        : [...data.trainingDays, firstDay],
    });
  }

  async function submit() {
    if (!data.goalType) return;
    setSubmitting(true);
    const result = await requestNewPlan({
      goalType: data.goalType,
      targetDistanceM: needsGoalDetails ? selectedDistance : null,
      targetDate: needsGoalDetails ? data.targetDate : null,
      targetTimeS: needsGoalDetails && data.targetTime ? parseClock(data.targetTime) : null,
      planStartDate: data.planStartDate,
      firstTrainingDate: data.firstTrainingDate,
      currentCapacityM: Number(data.currentCapacityKm.replace(",", ".")) * 1000,
      currentWeeklyVolumeM: Number(data.currentWeeklyVolumeKm.replace(",", ".")) * 1000,
      benchmarkDistanceM: data.benchmarkDistanceKm ? Number(data.benchmarkDistanceKm.replace(",", ".")) * 1000 : null,
      benchmarkTimeS: data.benchmarkTime ? parseClock(data.benchmarkTime) : null,
      sessionsPerWeek: data.sessionsPerWeek,
      trainingDays: data.trainingDays,
      longRunDay: data.longRunDay,
      maxWeekdayMinutes: Number(data.maxWeekdayMinutes),
      maxWeekendMinutes: Number(data.maxWeekendMinutes),
      ambition: data.ambition,
      limitations: data.limitations,
    });
    setSubmitting(false);
    if (!result.ok || !result.requestId) {
      toast.error("Planvoorstel niet gestart", {
        description: result.error ?? "De aanvraag kon niet worden gestart.",
        duration: 6500,
      });
      return;
    }
    setRequestId(result.requestId);
    setRequestState("requested");
    toast.info("Coach maakt je planvoorstel", {
      description: "Je antwoorden zijn bewaard. Dit kan enkele minuten duren.",
    });
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button type="button" className="card-insight flex w-full items-center gap-3 p-4 text-left active:bg-s2">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-recovery/10 text-recovery">
            <Plus className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="label text-recovery">Nieuw doel</span>
            <span className="mt-1 block text-[15px] font-semibold text-ink">Maak een nieuw trainingsplan</span>
            <span className="mt-1 block text-[11px] leading-relaxed text-muted">Beantwoord enkele gerichte vragen; je coach maakt daarna een voorstel.</span>
          </span>
          {requestState === "requested" || requestState === "running" ? <LoaderCircle className="size-4 animate-spin text-recovery" /> : <ChevronRight className="size-4 text-faint" />}
        </button>
      </DrawerTrigger>

      <DrawerContent>
        <div className="border-b border-line px-4 pb-3 pt-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DrawerTitle className="text-[19px] font-semibold tracking-[-0.025em]">Nieuw trainingsplan</DrawerTitle>
              <DrawerDescription className="mt-1 text-[11px] leading-relaxed text-faint">
                Je huidige plan blijft actief tot jij het voorstel goedkeurt.
              </DrawerDescription>
            </div>
            <Badge variant="recovery">Stap {visualStep + 1}/{steps}</Badge>
          </div>
          <Progress value={((visualStep + 1) / steps) * 100} indicatorClassName="bg-recovery" className="mt-3" />
        </div>

        <div className="overflow-y-auto px-4 pb-6 pt-4">
          {requestState === "requested" || requestState === "running" ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
              <span className="grid size-14 place-items-center rounded-full border border-recovery/25 bg-recovery/10 text-recovery">
                <LoaderCircle className="size-6 animate-spin" />
              </span>
              <h3 className="mt-5 text-[18px] font-semibold">Je coach bouwt het voorstel</h3>
              <p className="mt-2 max-w-[310px] text-[12px] leading-relaxed text-muted">
                {requestState === "requested" ? "De aanvraag staat klaar voor de worker." : "Garmin-data, coachregels en je antwoorden worden nu samengebracht."}
              </p>
              <div className="mt-5 rounded-[14px] border border-line bg-s2/55 px-4 py-3 text-[10px] leading-relaxed text-faint">
                Dit kan enkele minuten duren. Je mag deze drawer sluiten.
              </div>
            </div>
          ) : requestState === "done" ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
              <span className="grid size-14 place-items-center rounded-full border border-teal/25 bg-teal/10 text-teal"><Check className="size-6" /></span>
              <h3 className="mt-5 text-[18px] font-semibold">Je voorstel staat klaar</h3>
              <p className="mt-2 max-w-[310px] text-[12px] leading-relaxed text-muted">Sluit deze wizard en vergelijk het nieuwe schema met je huidige plan.</p>
              <Button className="mt-5" onClick={() => { setOpen(false); router.refresh(); }}>Voorstel bekijken <ArrowRight /></Button>
            </div>
          ) : requestState === "error" ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
              <span className="grid size-14 place-items-center rounded-full border border-danger/25 bg-danger/10 text-danger"><RefreshCw className="size-6" /></span>
              <h3 className="mt-5 text-[18px] font-semibold">De analyse is niet afgerond</h3>
              <p className="mt-2 max-w-[330px] text-[12px] leading-relaxed text-muted">{requestError || "Probeer opnieuw nadat de worker is gecontroleerd."}</p>
              <Button variant="secondary" className="mt-5" onClick={() => { setRequestState("idle"); setRequestId(null); }}>Antwoorden behouden</Button>
            </div>
          ) : (
            <>
              {step === 0 ? (
                <section>
                  <div className="label">Wat wil je bereiken?</div>
                  <h3 className="mt-1.5 text-[18px] font-semibold tracking-[-0.02em]">Kies het soort doel</h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">De volgende vragen passen zich aan je keuze aan.</p>
                  <div className="mt-4 grid gap-2">
                    {GOALS.map((goal) => <Choice key={goal.value} {...goal} active={data.goalType === goal.value} onClick={() => { update({ goalType: goal.value }); if (goal.value === "race" && data.targetTime === "20:00") update({ goalType: goal.value, targetTime: "" }); }} />)}
                  </div>
                </section>
              ) : null}

              {step === 1 && needsGoalDetails ? (
                <section>
                  <div className="label">Doel scherpstellen</div>
                  <h3 className="mt-1.5 text-[18px] font-semibold">Waar train je precies voor?</h3>
                  <div className="mt-4">
                    <div className="text-[11px] font-semibold text-muted">Afstand</div>
                    <div className="mt-2 grid grid-cols-4 gap-1.5">
                      {DISTANCES.map((distance) => (
                        <button key={distance.label} type="button" onClick={() => update({ targetDistanceM: distance.value, customDistanceKm: "" })} className={cn("min-h-11 rounded-xl border text-[10px] font-semibold", !data.customDistanceKm && data.targetDistanceM === distance.value ? "border-recovery/50 bg-recovery/10 text-recovery" : "border-line bg-s2 text-muted")}>{distance.label}</button>
                      ))}
                    </div>
                    <Input className="mt-2" inputMode="decimal" placeholder="Andere afstand in km" value={data.customDistanceKm} onChange={(event) => update({ customDistanceKm: event.target.value })} />
                  </div>

                  <div className="mt-4 grid gap-4">
                    <label>
                      <span className="text-[11px] font-semibold text-muted">{data.goalType === "race" ? "Wedstrijddatum" : "Doeldatum (optioneel)"}</span>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button type="button" variant="secondary" className="mt-2 w-full justify-start normal-case tracking-normal"><CalendarDays />{formatDate(data.targetDate)}</Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-1" align="start">
                          <Calendar mode="single" selected={data.targetDate ? new Date(`${data.targetDate}T12:00:00`) : undefined} onSelect={(date) => update({ targetDate: dateToIso(date) })} disabled={{ before: new Date() }} />
                        </PopoverContent>
                      </Popover>
                    </label>
                    <label>
                      <span className="text-[11px] font-semibold text-muted">{data.goalType === "time_target" ? "Gewenste tijd" : "Gewenste eindtijd (optioneel)"}</span>
                      <Input className="mt-2" inputMode="numeric" placeholder={selectedDistance && selectedDistance > 20_000 ? "uu:mm:ss" : "mm:ss"} value={data.targetTime} onChange={(event) => update({ targetTime: event.target.value })} />
                    </label>
                  </div>
                </section>
              ) : null}

              {step === baselineStep ? (
                <section>
                  <div className="label">Startpunt</div>
                  <h3 className="mt-1.5 text-[18px] font-semibold">Wat kun je nu echt aan?</h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">We gebruiken dit als plafond voor een realistische eerste trainingsfase.</p>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <label className="rounded-[16px] border border-line bg-s2/55 p-3">
                      <span className="text-[10px] font-semibold text-faint">Aaneengesloten lopen</span>
                      <div className="mt-2 flex items-end gap-1"><Input className="h-10 border-0 bg-transparent p-0 text-[22px] font-semibold" inputMode="decimal" value={data.currentCapacityKm} onChange={(event) => update({ currentCapacityKm: event.target.value })} /><span className="pb-2 text-[10px] text-faint">km</span></div>
                    </label>
                    <label className="rounded-[16px] border border-line bg-s2/55 p-3">
                      <span className="text-[10px] font-semibold text-faint">Gemiddeld per week</span>
                      <div className="mt-2 flex items-end gap-1"><Input className="h-10 border-0 bg-transparent p-0 text-[22px] font-semibold" inputMode="decimal" value={data.currentWeeklyVolumeKm} onChange={(event) => update({ currentWeeklyVolumeKm: event.target.value })} /><span className="pb-2 text-[10px] text-faint">km</span></div>
                    </label>
                  </div>
                  <div className="mt-5 rounded-[16px] border border-line bg-canvas/35 p-3">
                    <div className="flex items-center gap-2"><CircleGauge className="size-4 text-recovery" /><span className="text-[12px] font-semibold">Recente beste inschatting</span></div>
                    <p className="mt-1 text-[10px] leading-relaxed text-faint">Optioneel: een recente inspanning die representatief was.</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <label><span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-faint">Afstand</span><Input className="mt-1 h-10" inputMode="decimal" placeholder="km" value={data.benchmarkDistanceKm} onChange={(event) => update({ benchmarkDistanceKm: event.target.value })} /></label>
                      <label><span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-faint">Tijd</span><Input className="mt-1 h-10" inputMode="numeric" placeholder="mm:ss" value={data.benchmarkTime} onChange={(event) => update({ benchmarkTime: event.target.value })} /></label>
                    </div>
                  </div>
                </section>
              ) : null}

              {step === planStartStep ? (
                <section>
                  <div className="label">Startmoment</div>
                  <h3 className="mt-1.5 text-[18px] font-semibold">Wanneer moet je nieuwe schema beginnen?</h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">
                    De planstart opent je trainingsblok. Je eerste training mag op die dag of enkele dagen later vallen.
                  </p>

                  <div className="mt-5 grid gap-3">
                    <div className="rounded-[17px] border border-line bg-s2/55 p-3.5">
                      <div className="flex items-start gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-recovery/10 text-recovery">
                          <CalendarDays className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] font-semibold">Start van het schema</div>
                          <p className="mt-0.5 text-[10px] leading-relaxed text-faint">Vanaf deze datum gelden het nieuwe blok en de opbouwregels.</p>
                        </div>
                      </div>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button type="button" variant="secondary" className="mt-3 w-full justify-start normal-case tracking-normal">
                            <CalendarDays />{formatDate(data.planStartDate)}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-1" align="start">
                          <Calendar
                            mode="single"
                            selected={new Date(`${data.planStartDate}T12:00:00`)}
                            onSelect={selectPlanStart}
                            disabled={{ before: startOfToday() }}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>

                    <div className="rounded-[17px] border border-line bg-s2/55 p-3.5">
                      <div className="flex items-start gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-run-easy/10 text-run-easy">
                          <Route className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] font-semibold">Eerste trainingsdag</div>
                          <p className="mt-0.5 text-[10px] leading-relaxed text-faint">De coach plant de eerste echte sessie precies op deze dag.</p>
                        </div>
                      </div>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button type="button" variant="secondary" className="mt-3 w-full justify-start normal-case tracking-normal">
                            <CalendarDays />{formatDate(data.firstTrainingDate)}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-1" align="start">
                          <Calendar
                            mode="single"
                            selected={new Date(`${data.firstTrainingDate}T12:00:00`)}
                            onSelect={selectFirstTraining}
                            disabled={{ before: new Date(`${data.planStartDate}T00:00:00`) }}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>

                  <p className="mt-3 rounded-[13px] border border-line bg-canvas/35 px-3 py-2.5 text-[10px] leading-relaxed text-faint">
                    {formatDate(data.firstTrainingDate)} wordt automatisch als beschikbare trainingsdag meegenomen in de volgende stap.
                  </p>
                </section>
              ) : null}

              {step === availabilityStep ? (
                <section>
                  <div className="label">Beschikbaarheid</div>
                  <h3 className="mt-1.5 text-[18px] font-semibold">Wanneer past trainen?</h3>
                  <div className="mt-4 flex items-center justify-between rounded-[16px] border border-line bg-s2/55 p-3">
                    <div><div className="text-[12px] font-semibold">Trainingen per week</div><div className="mt-0.5 text-[10px] text-faint">Rustdagen worden bewust beschermd</div></div>
                    <div className="flex items-center gap-2"><button type="button" className="grid size-9 place-items-center rounded-full border border-line bg-s3 text-lg" onClick={() => update({ sessionsPerWeek: Math.max(2, data.sessionsPerWeek - 1) })}>−</button><span className="numeral w-5 text-center text-lg font-bold">{data.sessionsPerWeek}</span><button type="button" className="grid size-9 place-items-center rounded-full border border-line bg-s3 text-lg" onClick={() => update({ sessionsPerWeek: Math.min(6, data.sessionsPerWeek + 1) })}>+</button></div>
                  </div>
                  <div className="mt-5 text-[11px] font-semibold text-muted">Op welke dagen kun je trainen?</div>
                  <div className="mt-2 grid grid-cols-7 gap-1.5">
                    {DAYS.map((day) => <button key={day.value} type="button" onClick={() => toggleDay(day.value)} className={cn("aspect-square rounded-xl border text-[10px] font-semibold", data.trainingDays.includes(day.value) ? "border-recovery/50 bg-recovery/10 text-recovery" : "border-line bg-s2 text-faint")}>{day.short}</button>)}
                  </div>
                  <div className="mt-5 text-[11px] font-semibold text-muted">Voorkeur lange duurloop</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => update({ longRunDay: null })} className={cn("min-h-9 rounded-full border px-3 text-[10px] font-semibold", !data.longRunDay ? "border-recovery/50 bg-recovery/10 text-recovery" : "border-line bg-s2 text-muted")}>Coach kiest</button>
                    {DAYS.filter((day) => data.trainingDays.includes(day.value)).map((day) => <button key={day.value} type="button" onClick={() => update({ longRunDay: day.value })} className={cn("min-h-9 rounded-full border px-3 text-[10px] font-semibold", data.longRunDay === day.value ? "border-run-long/50 bg-run-long/10 text-run-long" : "border-line bg-s2 text-muted")}>{day.label}</button>)}
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-2">
                    <label><span className="text-[10px] font-semibold text-faint">Max. weekdag</span><div className="mt-1 flex items-center gap-2"><Input inputMode="numeric" value={data.maxWeekdayMinutes} onChange={(event) => update({ maxWeekdayMinutes: event.target.value })} /><span className="text-[10px] text-faint">min</span></div></label>
                    <label><span className="text-[10px] font-semibold text-faint">Max. weekend</span><div className="mt-1 flex items-center gap-2"><Input inputMode="numeric" value={data.maxWeekendMinutes} onChange={(event) => update({ maxWeekendMinutes: event.target.value })} /><span className="text-[10px] text-faint">min</span></div></label>
                  </div>
                </section>
              ) : null}

              {step === reviewStep ? (
                <section>
                  <div className="label">Laatste keuzes</div>
                  <h3 className="mt-1.5 text-[18px] font-semibold">Hoe mag de coach opbouwen?</h3>
                  <div className="mt-4 grid gap-2">
                    {AMBITIONS.map((ambition) => <button key={ambition.value} type="button" onClick={() => update({ ambition: ambition.value })} className={cn("flex min-h-14 items-center justify-between rounded-[15px] border px-3 text-left", data.ambition === ambition.value ? "border-recovery/50 bg-recovery/10" : "border-line bg-s2/55")}><span><span className="block text-[12px] font-semibold">{ambition.label}</span><span className="mt-0.5 block text-[10px] text-faint">{ambition.description}</span></span>{data.ambition === ambition.value ? <Check className="size-4 text-recovery" /> : null}</button>)}
                  </div>
                  <label className="mt-5 block"><span className="text-[11px] font-semibold text-muted">Klachten, beperkingen of praktische opmerkingen</span><Textarea className="mt-2" maxLength={700} placeholder="Bijvoorbeeld: gevoelige knie, geen training op reisweek, liever geen baantraining..." value={data.limitations} onChange={(event) => update({ limitations: event.target.value })} /></label>
                  <div className="mt-5 rounded-[18px] border border-line-strong bg-canvas/40 p-4">
                    <div className="flex items-center gap-2"><Sparkles className="size-4 text-recovery" /><span className="label text-recovery">Samenvatting voor de coach</span></div>
                    <div className="mt-3 divide-y divide-line text-[11px]">
                      <div className="flex justify-between gap-4 py-2"><span className="text-faint">Doel</span><span className="text-right font-semibold">{GOALS.find((goal) => goal.value === data.goalType)?.title}{needsGoalDetails ? ` · ${distanceName(selectedDistance)}` : ""}</span></div>
                      {data.targetDate ? <div className="flex justify-between gap-4 py-2"><span className="text-faint">Datum</span><span className="text-right font-semibold">{formatDate(data.targetDate)}</span></div> : null}
                      {needsGoalDetails && data.targetTime ? <div className="flex justify-between gap-4 py-2"><span className="text-faint">Tijd</span><span className="text-right font-semibold">{data.targetTime}</span></div> : null}
                      <div className="flex justify-between gap-4 py-2"><span className="text-faint">Startpunt</span><span className="text-right font-semibold">{data.currentCapacityKm} km · {data.currentWeeklyVolumeKm} km/week</span></div>
                      <div className="flex justify-between gap-4 py-2"><span className="text-faint">Planstart</span><span className="text-right font-semibold">{formatDate(data.planStartDate)}</span></div>
                      <div className="flex justify-between gap-4 py-2"><span className="text-faint">Eerste training</span><span className="text-right font-semibold">{formatDate(data.firstTrainingDate)}</span></div>
                      <div className="flex justify-between gap-4 py-2"><span className="text-faint">Planning</span><span className="text-right font-semibold">{data.sessionsPerWeek}×/week · lang op {dayName(data.longRunDay)}</span></div>
                    </div>
                  </div>
                  <p className="mt-3 text-[10px] leading-relaxed text-faint">De coach maakt eerst een adaptief blok van vier weken binnen je langetermijndoel. Het voorstel gebruikt Claude Opus en kost doorgaans ongeveer $0,30–$0,60.</p>
                </section>
              ) : null}

              <div className="mt-6 grid grid-cols-[0.75fr_1.25fr] gap-2">
                <Button variant="secondary" onClick={previous} disabled={step === 0 || submitting}><ArrowLeft /> Terug</Button>
                {step === reviewStep ? <Button onClick={submit} disabled={submitting}>{submitting ? <LoaderCircle className="animate-spin" /> : <Sparkles />} Planvoorstel maken</Button> : <Button onClick={next}>Volgende <ArrowRight /></Button>}
              </div>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
