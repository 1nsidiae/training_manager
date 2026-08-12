"use client";

import { Activity, ArrowDown, ArrowRight, ArrowUp, HeartPulse, Info, MoonStar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InteractiveTrendChart } from "@/components/interactive-trend-chart";
import { Ring } from "@/components/ring";
import { SleepStageTimeline } from "@/components/sleep-stage-timeline";
import { hours } from "@/lib/format";
import type { Wellness } from "@/lib/queries";

type Kind = "readiness" | "sleep" | "hrv";
type Tone = { color: string; hex: string; label: string };

type Props = {
  kind: Kind;
  latest: Wellness | null;
  series: Wellness[];
  selectedDay: string;
  tone: Tone;
};

function isoAtOffset(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function dateLabel(day: string) {
  return new Date(`${day}T12:00:00`).toLocaleDateString("nl-BE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function valueFor(kind: Kind, row: Wellness) {
  if (kind === "readiness") return row.training_readiness_score;
  if (kind === "sleep") return row.sleep_total_s == null ? null : row.sleep_total_s / 3600;
  return row.hrv_last_night_avg;
}

function average(values: (number | null)[]) {
  const measured = values.filter((value): value is number => value != null);
  return measured.length ? measured.reduce((sum, value) => sum + value, 0) / measured.length : null;
}

function averageBetween(
  kind: Kind,
  series: Wellness[],
  startDay: string,
  endDay: string,
) {
  return average(
    series
      .filter((row) => row.day >= startDay && row.day <= endDay)
      .map((row) => valueFor(kind, row)),
  );
}

function formatMetric(kind: Kind, value: number | null, compact = false) {
  if (value == null) return "Geen meting";
  if (kind === "sleep") return `${value.toFixed(1).replace(".", ",")} u`;
  if (kind === "hrv") return `${Math.round(value)} ms`;
  return compact ? `${Math.round(value)}` : `${Math.round(value)} / 100`;
}

function formatDelta(kind: Kind, current: number | null, previous: number | null) {
  if (current == null || previous == null) return null;
  const delta = current - previous;
  const precision = kind === "sleep" ? 1 : 0;
  const rounded = Number(delta.toFixed(precision));
  const absolute = Math.abs(rounded).toFixed(precision).replace(".", ",");
  const unit = kind === "sleep" ? " u" : kind === "hrv" ? " ms" : " pt";
  return {
    delta: rounded,
    label: `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${absolute}${unit}`,
  };
}

function comparisonTone(delta: number | null | undefined) {
  if (delta == null || delta === 0) {
    return {
      pill: "border-line bg-s3/70 text-muted",
      icon: "text-faint",
    };
  }
  if (delta > 0) {
    return {
      pill: "border-teal/25 bg-teal/10 text-teal",
      icon: "text-teal",
    };
  }
  return {
    pill: "border-danger/25 bg-danger/10 text-danger",
    icon: "text-danger",
  };
}

function Comparison({
  label,
  current,
  previous,
  kind,
}: {
  label: string;
  current: number | null;
  previous: number | null;
  kind: Kind;
}) {
  const comparison = formatDelta(kind, current, previous);
  const Icon = !comparison || comparison.delta === 0 ? ArrowRight : comparison.delta > 0 ? ArrowUp : ArrowDown;
  const changeTone = comparisonTone(comparison?.delta);
  return (
    <div className="rounded-row bg-s2 px-3 py-3">
      <div className="text-[10px] font-semibold text-faint">{label}</div>
      <div className={`mt-2 inline-flex min-h-7 items-center gap-1 rounded-md border px-2 ${changeTone.pill}`}>
        <Icon className={`size-3.5 ${changeTone.icon}`} />
        <span className="numeral text-[15px] font-semibold">{comparison?.label ?? "–"}</span>
      </div>
      <div className="micro mt-1.5">Vorige: {formatMetric(kind, previous)}</div>
    </div>
  );
}

function AverageComparison({
  label,
  current,
  previous,
  kind,
}: {
  label: string;
  current: number | null;
  previous: number | null;
  kind: Kind;
}) {
  const comparison = formatDelta(kind, current, previous);
  const Icon = !comparison || comparison.delta === 0 ? ArrowRight : comparison.delta > 0 ? ArrowUp : ArrowDown;
  const changeTone = comparisonTone(comparison?.delta);

  return (
    <div className="row p-3">
      <div className="micro">{label}</div>
      <div className="numeral mt-2 text-[20px]">{formatMetric(kind, current, true)}</div>
      <div className={`mt-2 inline-flex min-h-6 items-center gap-1 rounded-md border px-1.5 ${changeTone.pill}`}>
        <Icon className={`size-3 ${changeTone.icon}`} />
        <span className="text-[10px] font-bold">{comparison?.label ?? "Geen vergelijking"}</span>
      </div>
    </div>
  );
}

function MetricRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 border-b border-line py-2.5 last:border-0">
      <span className="text-[12px] font-medium text-muted">{label}</span>
      <span className={`text-right text-[12px] font-semibold ${accent ?? "text-ink"}`}>{value}</span>
    </div>
  );
}

const copy = {
  readiness: {
    title: "Trainingsfitheid",
    short: "Trainingsfitheid",
    explanation:
      "Garmin berekent je trainingsfitheid uit Slaapscore, Hersteltijd, HRV-status, Acute belasting, Slaapgeschiedenis en Stressgeschiedenis. De score helpt bepalen hoe klaar je bent om te trainen; je eigen gevoel blijft meewegen.",
  },
  sleep: {
    title: "Slaapduur",
    short: "Slaapduur",
    explanation:
      "Dit is je door Garmin gemeten totale slaaptijd, opgesplitst in diepe, lichte en REM-slaap. Slaapduur is niet hetzelfde als Slaapscore: die score beoordeelt de kwaliteit van de volledige nacht.",
  },
  hrv: {
    title: "HRV-status",
    short: "HRV-status",
    explanation:
      "Garmin vergelijkt je gemiddelde nachtelijke hartslagvariabiliteit met je persoonlijke baseline. Vooral de 7-daagse trend en de status zijn betekenisvol; één losse nacht geeft weinig context.",
  },
} satisfies Record<Kind, { title: string; short: string; explanation: string }>;

export function BiometricMetricDrawer({ kind, latest, series, selectedDay, tone }: Props) {
  const metric = copy[kind];
  const current = latest ? valueFor(kind, latest) : null;
  const yesterdayRow = series.find((row) => row.day === isoAtOffset(selectedDay, -1));
  const yesterday = yesterdayRow ? valueFor(kind, yesterdayRow) : null;
  const avg7 = averageBetween(kind, series, isoAtOffset(selectedDay, -6), selectedDay);
  const previous7 = averageBetween(kind, series, isoAtOffset(selectedDay, -13), isoAtOffset(selectedDay, -7));
  const avg28 = averageBetween(kind, series, isoAtOffset(selectedDay, -27), selectedDay);
  const previous28 = averageBetween(kind, series, isoAtOffset(selectedDay, -55), isoAtOffset(selectedDay, -28));
  const chartData = Array.from({ length: 28 }, (_, index) => {
    const day = isoAtOffset(selectedDay, index - 27);
    const row = series.find((item) => item.day === day);
    return { day, value: row ? valueFor(kind, row) : null };
  });
  const display = current == null
    ? "–"
    : kind === "sleep"
      ? current.toFixed(1)
      : Math.round(current).toString();
  const suffix = kind === "sleep" ? "u" : kind === "hrv" ? "ms" : undefined;
  const max = kind === "sleep" ? 8 : kind === "hrv" ? Math.max(latest?.hrv_baseline_high ?? 120, 120) : 100;
  const Icon = kind === "readiness" ? Activity : kind === "sleep" ? MoonStar : HeartPulse;

  return (
    <Drawer>
      <DrawerTrigger className="focus-ring w-full rounded-card text-left" aria-label={`Open details voor ${metric.title}`}>
        <Card className="metric-score-card surface-pressable flex min-h-[146px] flex-col items-center justify-center gap-2.5 px-1.5 py-3">
          <Ring value={current} max={max} color={tone.hex} size={78} stroke={5} animate>
            <div className="flex items-baseline">
              <span className={`numeral text-[22px] font-bold ${tone.color}`}>{display}</span>
              {suffix ? <span className="ml-0.5 text-[9px] text-faint">{suffix}</span> : null}
            </div>
          </Ring>
          <div className="text-center">
            <div className="text-[11px] font-semibold">{metric.short}</div>
            <div className={`mt-0.5 text-[9px] font-bold uppercase tracking-[0.06em] ${tone.color}`}>{tone.label}</div>
          </div>
        </Card>
      </DrawerTrigger>

      <DrawerContent className="max-h-[94dvh]">
        <div className="flex items-start justify-between gap-3 px-4 pb-2 pt-3">
          <div>
            <DrawerTitle className="text-[18px] font-semibold tracking-[-0.02em]">{metric.title}</DrawerTitle>
            <DrawerDescription className="mt-0.5 text-[11px] font-medium text-faint">
              Garmin · {dateLabel(selectedDay)}
            </DrawerDescription>
          </div>
          <Badge variant="outline"><Icon className="size-3" /> {tone.label}</Badge>
        </div>

        <div className="overflow-y-auto px-4 pb-7">
          <div className="flex flex-col items-center py-4">
            <Ring value={current} max={max} color={tone.hex} size={142} stroke={9} animate>
              <div className="text-center">
                <div className={`numeral text-[40px] font-bold ${tone.color}`}>{display}</div>
                <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.11em] text-muted">
                  {suffix ? `${metric.title} · ${suffix}` : metric.title}
                </div>
              </div>
            </Ring>
          </div>

          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overzicht</TabsTrigger>
              <TabsTrigger value="trend">Trend</TabsTrigger>
              <TabsTrigger value="about">Uitleg</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <Comparison label="vs gisteren" current={current} previous={yesterday} kind={kind} />
                <Comparison label="vs vorige 7d" current={avg7} previous={previous7} kind={kind} />
                <Comparison label="vs vorige 28d" current={avg28} previous={previous28} kind={kind} />
              </div>

              <Card className="px-4 py-1">
                {kind === "readiness" ? (
                  <>
                    <MetricRow label="Trainingsfitheid" value={formatMetric(kind, current)} accent={tone.color} />
                    <MetricRow label="Garmin-niveau" value={tone.label} />
                    <MetricRow label="Slaapscore" value={latest?.sleep_score != null ? `${latest.sleep_score} / 100` : "Geen meting"} />
                    <MetricRow label="HRV-status" value={latest?.hrv_status ? copyHrvStatus(latest.hrv_status) : "Geen status"} />
                  </>
                ) : kind === "sleep" && latest ? (
                  <>
                    <MetricRow label="Totale slaaptijd" value={hours(latest.sleep_total_s)} accent="text-sleep" />
                    {latest.sleep_score != null ? <MetricRow label="Slaapscore" value={`${latest.sleep_score} / 100`} /> : null}
                    <div className="py-3">
                      <SleepStageTimeline wellness={latest} />
                    </div>
                  </>
                ) : (
                  <>
                    <MetricRow label="Gemiddelde vannacht" value={formatMetric(kind, current)} accent="text-recovery" />
                    <MetricRow label="Persoonlijke baseline" value={latest?.hrv_baseline_low != null && latest.hrv_baseline_high != null ? `${latest.hrv_baseline_low}–${latest.hrv_baseline_high} ms` : "Nog niet beschikbaar"} />
                    <MetricRow label="7-daags gemiddelde" value={formatMetric(kind, avg7)} />
                    <MetricRow label="HRV-status" value={latest?.hrv_status ? copyHrvStatus(latest.hrv_status) : "Geen status"} />
                  </>
                )}
              </Card>
            </TabsContent>

            <TabsContent value="trend" className="space-y-4">
              <Card className="p-4">
                <div className="mb-4 flex items-end justify-between gap-3">
                  <div>
                    <div className="label">Laatste 28 dagen</div>
                    <div className="mt-1 text-[15px] font-semibold">{metric.title}</div>
                  </div>
                  <span className={`numeral text-[20px] font-semibold ${tone.color}`}>{formatMetric(kind, avg28, true)}</span>
                </div>
                <InteractiveTrendChart
                  data={chartData}
                  color={tone.hex}
                  average={avg28}
                  formatValue={(value) => formatMetric(kind, value, true)}
                />
              </Card>
              <div className="grid grid-cols-2 gap-2">
                <AverageComparison label="7-daags gemiddelde" current={avg7} previous={previous7} kind={kind} />
                <AverageComparison label="28-daags gemiddelde" current={avg28} previous={previous28} kind={kind} />
              </div>
            </TabsContent>

            <TabsContent value="about">
              <Card className="border-line-strong p-4">
                <div className="flex items-center gap-2 text-recovery">
                  <Info className="size-4" />
                  <span className="label !text-recovery">Garmin-metriek</span>
                </div>
                <p className="mt-3 text-[13px] leading-relaxed text-muted">{metric.explanation}</p>
                <p className="mt-3 border-t border-line pt-3 text-[10px] leading-relaxed text-faint">
                  Vergelijkingen gebruiken alleen gemeten dagen. Ontbrekende horlogedata wordt niet als nul meegerekend.
                </p>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function copyHrvStatus(status: string) {
  if (status === "BALANCED") return "Gebalanceerd";
  if (status === "UNBALANCED") return "Niet gebalanceerd";
  if (status === "LOW") return "Laag";
  if (status === "POOR") return "Slecht";
  return "Geen status";
}
