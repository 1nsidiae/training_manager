"use client";

import { useState } from "react";
import { AlertTriangle, Check, MessageSquareText } from "lucide-react";
import { FeedbackDrawer } from "@/components/feedback-drawer";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { RouteTrace } from "@/components/route-trace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import type { Activity, PlanSession, SessionCompliance, SessionFeedback } from "@/lib/queries";
import { ZONE_COLORS, dayLabel, duration, km } from "@/lib/format";

type Lap = {
  lap_index: number;
  distance_m: number | null;
  duration_s: number | null;
  avg_hr: number | null;
  avg_pace_s_per_km: number | null;
};

function pace(secondsPerKm: number | null | undefined): string {
  if (!secondsPerKm) return "–";
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function hms(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function performanceMetric(activity: Activity) {
  if (activity.sport === "swimming" && activity.avg_pace_s_per_km) {
    return { label: "Tempo", value: pace(activity.avg_pace_s_per_km / 10), unit: "/100 m" };
  }
  if (activity.sport === "cycling" && activity.distance_m && activity.duration_s) {
    const speed = (activity.distance_m / activity.duration_s) * 3.6;
    return { label: "Gem. snelheid", value: speed.toFixed(1), unit: "km/u" };
  }
  if (["running", "walking"].includes(activity.sport)) {
    return {
      label: "Tempo",
      value: activity.avg_pace_s_per_km ? pace(activity.avg_pace_s_per_km) : "–",
      unit: "/km",
    };
  }
  return {
    label: activity.elevation_gain_m ? "Hoogtemeters" : "Calorieën",
    value: activity.elevation_gain_m
      ? Math.round(activity.elevation_gain_m).toString()
      : activity.calories?.toString() ?? "–",
    unit: activity.elevation_gain_m ? "m" : "kcal",
  };
}

export function ActivityDrawer({
  activity,
  zones,
  feedback,
  matchedSession,
  children,
}: {
  activity: Activity;
  zones: number[];
  feedback: SessionFeedback | null;
  matchedSession: PlanSession | null;
  children: React.ReactNode;
}) {
  const [laps, setLaps] = useState<Lap[] | null>(null);
  const [route, setRoute] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Splits en route pas ophalen bij openen. Vooraf zou 25 activiteiten aan
  // laps en polylines betekenen die je meestal niet bekijkt.
  async function onOpenChange(open: boolean) {
    if (!open || laps || loading) return;
    setLoading(true);
    const sb = createClient();

    const [lapsRes, trackRes] = await Promise.all([
      sb
        .from("activity_laps")
        .select("lap_index, distance_m, duration_s, avg_hr, avg_pace_s_per_km")
        .eq("activity_id", activity.id)
        .order("lap_index"),
      sb
        .from("activity_tracks")
        .select("polyline")
        .eq("activity_id", activity.id)
        .maybeSingle(),
    ]);

    setLaps((lapsRes.data ?? []) as Lap[]);
    setRoute(trackRes.data?.polyline ?? null);
    setLoading(false);
  }

  const zoneTotal = zones.reduce((a, b) => a + b, 0);
  const easyPct = zoneTotal
    ? Math.round(((zones[0] + zones[1]) / zoneTotal) * 100)
    : null;
  const performance = performanceMetric(activity);
  const hasDistance = (activity.distance_m ?? 0) >= 100;

  return (
    <Drawer onOpenChange={onOpenChange}>
      <DrawerTrigger className="focus-ring block w-full rounded-card text-left">{children}</DrawerTrigger>
        <DrawerContent>
          <div className="px-4 pb-3 pt-3">
            <DrawerTitle className="text-[16px] font-semibold leading-tight tracking-[-0.015em]">
              {activity.name || "Activiteit"}
            </DrawerTitle>
            <DrawerDescription className="mt-0.5 text-[11px] font-medium text-faint">
              {dayLabel(activity.start_time_local.slice(0, 10))}
            </DrawerDescription>
          </div>

          <div className="overflow-y-auto px-4 pb-6">
            {route && (
              <div className="mb-3">
                <RouteTrace polyline={route} height={190} />
                <div className="mt-1.5 flex items-center gap-3">
                  <span className="flex items-center gap-1.5 text-[10px] text-faint">
                    <span className="size-1.5 rounded-full bg-teal" />
                    start
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] text-faint">
                    <span className="size-1.5 rounded-full border border-ink" />
                    finish
                  </span>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Stat
                label={hasDistance ? "Afstand" : "Calorieën"}
                value={hasDistance ? km(activity.distance_m) : activity.calories?.toString() ?? "–"}
                unit={hasDistance ? undefined : "kcal"}
              />
              <Stat label="Duur" value={duration(activity.duration_s)} />
              <Stat
                label={performance.label}
                value={performance.value}
                unit={performance.unit}
              />
            </div>

            <div className="mt-2 flex gap-2">
              <Stat label="Gem. HR" value={activity.avg_hr?.toString() ?? "–"} unit="bpm" />
              <Stat label="Max HR" value={activity.max_hr?.toString() ?? "–"} unit="bpm" />
              <Stat
                label="Easy"
                value={easyPct != null ? String(easyPct) : "–"}
                unit="%"
                tone={easyPct != null && easyPct < 60 ? "text-danger" : "text-ink"}
              />
            </div>

            {matchedSession?.targets?.compliance ? (
              <ComplianceSummary compliance={matchedSession.targets.compliance} />
            ) : null}

            {zoneTotal > 0 && (
              <Card className="mt-4 border-line-strong bg-s2/25 p-3.5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="label">Tijd per zone</div>
                  {easyPct != null ? (
                    <div className={`numeral text-[11px] font-bold ${easyPct >= 60 ? "text-teal" : "text-danger"}`}>
                      {easyPct}% rustig
                    </div>
                  ) : null}
                </div>
                <div className="mb-3 flex h-2 gap-px overflow-hidden rounded-full bg-canvas/40">
                  {zones.map((secs, i) =>
                    secs > 0 ? (
                      <div
                        key={i}
                        style={{
                          width: `${(secs / zoneTotal) * 100}%`,
                          background: ZONE_COLORS[i],
                        }}
                      />
                    ) : null,
                  )}
                </div>
                <div className="space-y-1.5">
                  {zones.map((secs, i) =>
                    secs > 0 ? (
                      <div key={i} className="flex items-center gap-2.5">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ background: ZONE_COLORS[i] }}
                        />
                        <span className="flex-1 text-[11px] font-medium text-muted">
                          Zone {i + 1}
                        </span>
                        <span className="numeral text-[11px] text-muted">
                          {hms(secs)}
                        </span>
                        <span className="numeral w-9 text-right text-[11px] font-semibold">
                          {Math.round((secs / zoneTotal) * 100)}%
                        </span>
                      </div>
                    ) : null,
                  )}
                </div>
              </Card>
            )}

            <section className="mt-3">
              {loading && (
                <Card className="border-line-strong bg-s2/25 p-3.5">
                  <div className="label mb-2">Splits</div>
                  <div className="text-[11px] text-faint">Laden…</div>
                </Card>
              )}
              {laps && laps.length === 0 && (
                <Card className="border-line-strong bg-s2/25 p-3.5">
                  <div className="label mb-2">Splits</div>
                  <div className="text-[11px] text-faint">Geen splits opgeslagen.</div>
                </Card>
              )}
              {laps && laps.length > 0 && (
                <SplitProfile laps={laps} />
              )}
            </section>

            <section className="mt-5 pb-2">
              <div className="mb-2 flex items-center justify-between">
                <div className="label">Jouw feedback</div>
                {feedback ? <Badge variant="teal">ingevuld</Badge> : null}
              </div>
              {feedback ? (
                <Card className="p-3.5">
                  <div className="grid grid-cols-3 gap-2">
                    <FeedbackStat label="Pijn" value={`${feedback.pain_score}/10`} tone={feedback.pain_score >= 6 ? "text-danger" : "text-ink"} />
                    <FeedbackStat label="Inspanning" value={`${feedback.extra?.rpe ?? "–"}/10`} />
                    <FeedbackStat label="Conditie" value={`${feedback.endurance_score}/10`} />
                  </div>
                  {feedback.notes ? (
                    <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-muted">
                      {feedback.notes}
                    </p>
                  ) : null}
                </Card>
              ) : (
                <p className="mb-3 text-[11px] leading-relaxed text-muted">
                  Voeg in enkele seconden toe hoe je lichaam en conditie reageerden.
                </p>
              )}
              <FeedbackDrawer
                activity={activity}
                session={matchedSession}
                feedback={feedback}
                nested
              >
                <Button variant={feedback ? "secondary" : "default"} className="mt-3 w-full">
                  <MessageSquareText />
                  {feedback ? "Feedback aanpassen" : "Feedback toevoegen"}
                </Button>
              </FeedbackDrawer>
            </section>
          </div>
        </DrawerContent>
    </Drawer>
  );
}

function ComplianceSummary({ compliance }: { compliance: SessionCompliance }) {
  if (compliance.status === "unknown") return null;
  const status = {
    met: { label: "Doel gehaald", variant: "positive" as const, icon: Check },
    partial: { label: "Deels buiten doel", variant: "warning" as const, icon: AlertTriangle },
    missed: { label: "Buiten doel", variant: "danger" as const, icon: AlertTriangle },
  }[compliance.status];
  const StatusIcon = status.icon;
  const paceTarget = compliance.pace_target_fast_s_per_km && compliance.pace_target_slow_s_per_km
    ? `${pace(compliance.pace_target_fast_s_per_km)}–${pace(compliance.pace_target_slow_s_per_km)}/km`
    : null;

  return (
    <Card className="mt-3 border-line-strong bg-s2/25 p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="label">Doelcontrole</div>
        <Badge variant={status.variant}><StatusIcon className="size-3" /> {status.label}</Badge>
      </div>
      <div className="mt-3 space-y-2">
        {compliance.planned_distance_m && compliance.actual_distance_m ? (
          <ComplianceRow
            label="Afstand"
            actual={km(compliance.actual_distance_m)}
            target={km(compliance.planned_distance_m)}
          />
        ) : compliance.planned_duration_s && compliance.actual_duration_s ? (
          <ComplianceRow
            label="Duur"
            actual={duration(compliance.actual_duration_s)}
            target={duration(compliance.planned_duration_s)}
          />
        ) : null}
        {compliance.hr_cap && compliance.avg_hr ? (
          <ComplianceRow
            label="Gem. hartslag"
            actual={`${compliance.avg_hr} bpm`}
            target={`max ${compliance.hr_cap} bpm`}
          />
        ) : null}
        {paceTarget && compliance.actual_pace_s_per_km ? (
          <ComplianceRow
            label="Tempo"
            actual={`${pace(compliance.actual_pace_s_per_km)}/km`}
            target={paceTarget}
          />
        ) : null}
      </div>
      {compliance.status !== "met" ? (
        <p className="mt-3 border-t border-line pt-3 text-[10px] leading-relaxed text-muted">
          Deze afwijking is geregistreerd. Twee opeenvolgende zware doelmissers met zware feedback verplichten een lichtere komende week.
        </p>
      ) : null}
    </Card>
  );
}

function ComplianceRow({ label, actual, target }: { label: string; actual: string; target: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-3">
      <span className="text-[10px] font-medium text-faint">{label}</span>
      <span className="text-right text-[10px] font-semibold text-ink">
        {actual} <span className="font-medium text-faint">· doel {target}</span>
      </span>
    </div>
  );
}

function SplitProfile({ laps }: { laps: Lap[] }) {
  const validPaces = laps
    .map((lap) => lap.avg_pace_s_per_km)
    .filter((value): value is number => value != null && value > 0);
  const fastestPace = validPaces.length ? Math.min(...validPaces) : null;

  return (
    <Card className="border-line-strong bg-s2/25 p-3.5">
      <div className="mb-3 flex items-end justify-between">
        <div className="label">Splits</div>
        {fastestPace != null ? (
          <div className="text-[9px] font-semibold text-faint">
            <span className="numeral text-recovery">{pace(fastestPace)}/km</span> snelste
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_3rem_2.5rem] items-end gap-2 px-0.5 pb-1.5">
        <span className="text-[8px] font-bold uppercase tracking-[0.1em] text-faint">Split</span>
        <span aria-hidden />
        <span className="text-right text-[8px] font-bold uppercase tracking-[0.1em] text-faint">Tempo</span>
        <span className="text-right text-[8px] font-bold uppercase tracking-[0.1em] text-faint">Gem HR</span>
      </div>

      <div className="space-y-1" role="list">
        {laps.map((lap) => {
          const isFastest = fastestPace != null && lap.avg_pace_s_per_km === fastestPace;
          const barWidth = fastestPace && lap.avg_pace_s_per_km
            ? Math.max(40, (fastestPace / lap.avg_pace_s_per_km) * 100)
            : 40;
          const splitDistance = lap.distance_m ? lap.distance_m / 1000 : null;
          const isPartial = splitDistance != null && Math.abs(splitDistance - 1) > 0.025;

          return (
            <div
              key={lap.lap_index}
              role="listitem"
              className="grid min-h-8 grid-cols-[1.75rem_minmax(0,1fr)_3rem_2.5rem] items-center gap-2"
              aria-label={`Split ${lap.lap_index + 1}, ${splitDistance?.toFixed(2) ?? "onbekende afstand"} kilometer, tempo ${pace(lap.avg_pace_s_per_km)} per kilometer, gemiddelde hartslag ${lap.avg_hr ?? "onbekend"}`}
            >
              <div className="min-w-0 text-center">
                <div className="numeral text-[11px] font-semibold text-muted">{lap.lap_index + 1}</div>
                {isPartial ? (
                  <div className="numeral mt-0.5 text-[7px] leading-none text-faint">
                    {splitDistance?.toFixed(2)}
                  </div>
                ) : null}
              </div>

              <div className="relative h-2 overflow-hidden rounded-full bg-canvas/45">
                <div
                  className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ${
                    isFastest ? "bg-recovery" : "bg-recovery/35"
                  }`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>

              <span className={`numeral text-right text-[11px] font-bold ${isFastest ? "text-recovery" : "text-ink"}`}>
                {pace(lap.avg_pace_s_per_km)}
              </span>
              <span className="numeral text-right text-[10px] font-medium text-faint">
                {lap.avg_hr ?? "–"}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function FeedbackStat({ label, value, tone = "text-ink" }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[9px] font-medium text-faint">{label}</div>
      <div className={`numeral mt-1 text-[16px] font-bold ${tone}`}>{value}</div>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  tone = "text-ink",
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: string;
}) {
  return (
    <div className="row flex-1 px-3 py-2.5">
      <div className="text-[10px] font-medium text-faint">{label}</div>
      <div className={`numeral mt-1 text-lg font-bold ${tone}`}>
        {value}
        {unit && <span className="ml-0.5 text-[10px] font-normal text-faint">{unit}</span>}
      </div>
    </div>
  );
}
