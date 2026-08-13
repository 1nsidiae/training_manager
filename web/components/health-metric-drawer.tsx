"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BatteryCharging,
  ChevronRight,
  Footprints,
  HeartPulse,
  Info,
  MoonStar,
} from "lucide-react";
import { InteractiveTrendChart, type TrendPoint } from "@/components/interactive-trend-chart";
import { InteractiveDayChart } from "@/components/interactive-day-chart";
import { InteractiveStepsChart } from "@/components/interactive-steps-chart";
import { SleepStageTimeline } from "@/components/sleep-stage-timeline";
import { Sparkline } from "@/components/sparkline";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Wellness } from "@/lib/queries";
import { cn } from "@/lib/utils";

export type HealthMetricKind =
  | "body_battery"
  | "stress"
  | "steps"
  | "resting_hr"
  | "sleep_score"
  | "vo2max";

type Period = "1" | "7" | "28" | "365";

const PERIOD_LABELS: Record<Period, string> = {
  "1": "1 dag",
  "7": "7 dagen",
  "28": "4 weken",
  "365": "1 jaar",
};

type Props = {
  kind: HealthMetricKind;
  wellness: Wellness[];
  vo2max?: TrendPoint[];
  selectedDay: string;
};

type MetricConfig = {
  name: string;
  source: string;
  color: string;
  goodDirection: "up" | "down" | "neutral";
  unit?: string;
  icon: ReactNode;
  explanation: string;
  value: (row: Wellness) => number | null;
  format: (value: number | null, compact?: boolean) => string;
};

const integer = (value: number | null) => value == null ? "–" : Math.round(value).toLocaleString("nl-BE");

const METRICS: Record<Exclude<HealthMetricKind, "vo2max">, MetricConfig> = {
  body_battery: {
    name: "Body Battery",
    source: "Garmin Body Battery",
    color: "#00f19f",
    goodDirection: "up",
    unit: "hoogste",
    icon: <BatteryCharging className="size-3.5" />,
    explanation: "Body Battery schat je beschikbare energiereserves op basis van HRV, stress, slaap en activiteit. Bekijk vooral het patroon over meerdere dagen; één losse piek vertelt niet het hele verhaal.",
    value: (row) => row.body_battery_high,
    format: integer,
  },
  stress: {
    name: "Stressniveau",
    source: "Garmin dagelijkse stress",
    color: "#ffde00",
    goodDirection: "down",
    icon: <Activity className="size-3.5" />,
    explanation: "Dit is je gemiddelde Garmin-stressniveau over de dag. Een dalende trend betekent doorgaans minder fysiologische belasting; training, ziekte, slaap en dagelijkse druk kunnen de waarde beïnvloeden.",
    value: (row) => row.avg_stress,
    format: integer,
  },
  steps: {
    name: "Stappen",
    source: "Garmin stappen",
    color: "#0093e7",
    goodDirection: "neutral",
    icon: <Footprints className="size-3.5" />,
    explanation: "Stappen tonen je dagelijkse loop- en wandelvolume buiten én tijdens activiteiten. Meer is niet automatisch beter: gebruik de trend om abrupte veranderingen in je totale belasting te herkennen.",
    value: (row) => row.steps,
    format: integer,
  },
  resting_hr: {
    name: "Rusthartslag",
    source: "Garmin rusthartslag",
    color: "#67aee6",
    goodDirection: "down",
    unit: "bpm",
    icon: <HeartPulse className="size-3.5" />,
    explanation: "Garmin bepaalt je dagelijkse rusthartslag uit de laagste stabiele hartslagperiodes. Een aanhoudende stijging ten opzichte van je eigen patroon kan op vermoeidheid, stress of ziekte wijzen.",
    value: (row) => row.resting_hr,
    format: (value, compact) => value == null ? "–" : compact ? `${Math.round(value)}` : `${Math.round(value)} bpm`,
  },
  sleep_score: {
    name: "Slaapscore",
    source: "Garmin Slaapscore",
    color: "#7ba1bb",
    goodDirection: "up",
    unit: "/ 100",
    icon: <MoonStar className="size-3.5" />,
    explanation: "Garmin Slaapscore vat slaapduur, slaapfasen, onrust en herstel samen op een schaal van 0 tot 100. De meerdaagse trend is nuttiger dan één uitzonderlijke nacht.",
    value: (row) => row.sleep_score,
    format: (value, compact) => value == null ? "–" : compact ? `${Math.round(value)}` : `${Math.round(value)} / 100`,
  },
};

const VO2_CONFIG = {
  name: "VO2max",
  source: "Garmin VO2max hardlopen",
  color: "#67aee6",
  goodDirection: "up" as const,
  unit: undefined,
  icon: <Activity className="size-3.5" />,
  explanation: "Garmin schat je VO2max tijdens geschikte hardloopsessies. De waarde verandert trager dan dagelijkse gezondheidsmetingen; kijk daarom naar de ontwikkeling over weken en maanden.",
  format: (value: number | null) => value == null ? "–" : Math.round(value).toString(),
};

function isoAtOffset(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function average(points: TrendPoint[]) {
  const values = points.map((point) => point.value).filter((value): value is number => value != null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function formatDate(day: string) {
  return new Date(`${day}T12:00:00`).toLocaleDateString("nl-BE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function signed(value: number, kind: HealthMetricKind) {
  const precision = kind === "vo2max" ? 1 : 0;
  const number = Math.abs(value).toFixed(precision).replace(".", ",");
  const unit = kind === "resting_hr" ? " bpm" : kind === "steps" ? "" : kind === "vo2max" ? "" : " pt";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${number}${unit}`;
}

function toneFor(delta: number | null, direction: MetricConfig["goodDirection"] | "up") {
  if (delta == null || Math.abs(delta) < 0.05) return "border-line bg-s3/70 text-muted";
  if (direction === "neutral") return "border-strain/25 bg-strain/10 text-strain";
  const positive = direction === "up" ? delta > 0 : delta < 0;
  return positive
    ? "border-teal/25 bg-teal/10 text-teal"
    : "border-danger/25 bg-danger/10 text-danger";
}

export function HealthMetricDrawer({ kind, wellness, vo2max = [], selectedDay }: Props) {
  const config = kind === "vo2max" ? VO2_CONFIG : METRICS[kind];
  const [period, setPeriod] = useState<Period>("28");
  const days = Number(period);
  const allPoints = useMemo<TrendPoint[]>(() => {
    if (kind === "vo2max") return vo2max;
    const metric = METRICS[kind];
    return wellness.map((row) => ({ day: row.day, value: metric.value(row) }));
  }, [kind, vo2max, wellness]);
  const measured = allPoints.filter((point) => point.value != null && point.day <= selectedDay);
  const current = measured.at(-1) ?? null;
  const selectedWellness = wellness.find((row) => row.day === selectedDay) ?? null;
  const stepBuckets = selectedWellness?.raw?.steps_detail?.buckets ?? [];
  const intraday = selectedWellness?.raw?.intraday_detail;

  function pointsBetween(start: string, end: string) {
    return allPoints.filter((point) => point.day >= start && point.day <= end);
  }

  function completePeriod(start: string, length: number) {
    const byDay = new Map(allPoints.map((point) => [point.day, point.value]));
    return Array.from({ length }, (_, index) => {
      const day = isoAtOffset(start, index);
      return { day, value: byDay.get(day) ?? null };
    });
  }

  const last7 = pointsBetween(isoAtOffset(selectedDay, -6), selectedDay);
  const previous7 = pointsBetween(isoAtOffset(selectedDay, -13), isoAtOffset(selectedDay, -7));
  const avg7 = average(last7);
  const prevAvg7 = average(previous7);
  const cardDelta = avg7 != null && prevAvg7 != null ? avg7 - prevAvg7 : null;
  const chartStart = isoAtOffset(selectedDay, -(days - 1));
  const chartData = completePeriod(chartStart, days);
  const previousData = pointsBetween(isoAtOffset(selectedDay, -(days * 2 - 1)), isoAtOffset(selectedDay, -days));
  const periodAverage = average(chartData);
  const previousAverage = average(previousData);
  const periodDelta = periodAverage != null && previousAverage != null ? periodAverage - previousAverage : null;
  const DirectionIcon = cardDelta == null || Math.abs(cardDelta) < 0.05 ? ArrowRight : cardDelta > 0 ? ArrowUp : ArrowDown;
  const PeriodIcon = periodDelta == null || Math.abs(periodDelta) < 0.05 ? ArrowRight : periodDelta > 0 ? ArrowUp : ArrowDown;
  const formatter = config.format;
  const sparkValues = allPoints
    .filter((point) => point.day >= isoAtOffset(selectedDay, -13) && point.day <= selectedDay)
    .map((point) => point.value);

  return (
    <Drawer>
      <DrawerTrigger className="focus-ring block w-full rounded-card text-left">
        <Card className="surface-pressable flex min-h-[158px] flex-col p-3.5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-baseline gap-1">
                <span className="numeral text-[2rem] font-bold text-ink">{formatter(current?.value ?? null, true)}</span>
                {config.unit ? <span className="text-xs text-faint">{config.unit}</span> : null}
              </div>
              <div
                className={cn(
                  "mt-1.5 inline-flex items-center gap-1 text-[9px] font-semibold",
                  cardDelta == null || Math.abs(cardDelta) < 0.05
                    ? "text-faint"
                    : config.goodDirection === "neutral"
                      ? "text-strain"
                      : (config.goodDirection === "up" ? cardDelta > 0 : cardDelta < 0)
                        ? "text-teal"
                        : "text-danger",
                )}
              >
                <DirectionIcon className="size-3" />
                <span>
                  {cardDelta == null ? "geen vergelijking" : `${signed(cardDelta, kind)} vs vorige 7d`}
                </span>
              </div>
            </div>
            <ChevronRight className="size-4 text-faint" />
          </div>

          {sparkValues.length > 1 ? (
            <div className="-mx-3.5 mt-2">
              <Sparkline values={sparkValues} color={config.color} height={26} />
            </div>
          ) : null}

          <div className="mt-auto flex items-center gap-1.5 pt-3 text-faint">
            {config.icon}
            <span className="text-xs font-medium">{config.name}</span>
          </div>
        </Card>
      </DrawerTrigger>

      <DrawerContent className="max-h-[94dvh]">
        <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-3">
          <div>
            <DrawerTitle className="text-[18px] font-semibold tracking-[-0.02em]">{config.name}</DrawerTitle>
            <DrawerDescription className="mt-0.5 text-[11px] font-medium text-faint">
              {config.source} · t/m {formatDate(selectedDay)}
            </DrawerDescription>
          </div>
          <Badge variant="outline">{config.icon} Garmin</Badge>
        </div>

        <div className="overflow-y-auto px-4">
          <div className="grid grid-cols-[1fr_auto] items-end gap-4 border-y border-line py-4">
            <div>
              <div className="label">Laatste meting</div>
              <div className="mt-1.5 text-[11px] font-medium text-faint">
                {current ? formatDate(current.day) : "Geen meting beschikbaar"}
              </div>
            </div>
            <div className="numeral text-[36px] font-bold" style={{ color: config.color }}>
              {formatter(current?.value ?? null)}
            </div>
          </div>

          {/* VO2max wordt alleen tijdens geschikte hardloopsessies berekend en
              beweegt over maanden, niet over uren. Een tabblad aanbieden dat
              per definitie leeg blijft is een doodlopende weg — dus tonen we
              hem daar niet. */}
          <Tabs value={period} onValueChange={(value) => setPeriod(value as Period)} className="mt-4">
            <TabsList>
              {kind !== "vo2max" ? <TabsTrigger value="1">1 dag</TabsTrigger> : null}
              <TabsTrigger value="7">7 dagen</TabsTrigger>
              <TabsTrigger value="28">4 weken</TabsTrigger>
              <TabsTrigger value="365">1 jaar</TabsTrigger>
            </TabsList>
          </Tabs>

          <Card className="mt-4 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="label">{kind === "steps" && period === "1" ? "Dagverloop" : "Ontwikkeling"}</div>
                <div className="mt-1 text-[13px] font-semibold">Laatste {PERIOD_LABELS[period]}</div>
              </div>
              <div className={cn("inline-flex h-7 items-center gap-1 rounded-md border px-2", toneFor(periodDelta, config.goodDirection))}>
                <PeriodIcon className="size-3.5" />
                <span className="text-[10px] font-bold">{periodDelta == null ? "–" : signed(periodDelta, kind)}</span>
              </div>
            </div>
            <div className="mt-3">
              {period === "1" ? (
                kind === "steps" ? (
                  <InteractiveStepsChart buckets={stepBuckets} color={config.color} />
                ) : kind === "body_battery" ? (
                  <InteractiveDayChart
                    data={intraday?.body_battery ?? []}
                    color={config.color}
                    formatValue={(value) => formatter(value, true)}
                  />
                ) : kind === "stress" ? (
                  <InteractiveDayChart
                    data={intraday?.stress ?? []}
                    color={config.color}
                    formatValue={(value) => formatter(value, true)}
                  />
                ) : kind === "resting_hr" ? (
                  <InteractiveDayChart
                    data={intraday?.heart_rate ?? []}
                    color={config.color}
                    reference={selectedWellness?.resting_hr}
                    formatValue={(value) => value == null ? "–" : `${Math.round(value)} bpm`}
                  />
                ) : kind === "sleep_score" && selectedWellness ? (
                  <div className="pt-1">
                    <SleepStageTimeline wellness={selectedWellness} />
                  </div>
                ) : (
                  <div className="grid min-h-[220px] place-items-center px-5 text-center">
                    <div>
                      <div className="text-[12px] font-semibold text-muted">Eén Garmin-assessment voor deze dag</div>
                      <p className="mt-1.5 text-[10px] leading-relaxed text-faint">
                        VO2max wordt tijdens geschikte hardloopsessies berekend en heeft geen zinvol verloop binnen één dag.
                      </p>
                    </div>
                  </div>
                )
              ) : (
                <InteractiveTrendChart
                  data={chartData}
                  color={config.color}
                  average={periodAverage}
                  formatValue={(value) => formatter(value, true)}
                />
              )}
            </div>
          </Card>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="row p-3">
              <div className="micro">Gemiddelde periode</div>
              <div className="numeral mt-2 text-[21px]">{formatter(periodAverage)}</div>
              <div className="micro mt-2">{chartData.filter((point) => point.value != null).length} metingen</div>
            </div>
            <div className="row p-3">
              <div className="micro">Vorige periode</div>
              <div className="numeral mt-2 text-[21px]">{formatter(previousAverage)}</div>
              <div className="micro mt-2">zelfde lengte</div>
            </div>
          </div>

          <Card className="mt-4 border-line-strong p-4">
            <div className="flex items-center gap-2" style={{ color: config.color }}>
              <Info className="size-4" />
              <span className="label" style={{ color: config.color }}>Wat dit betekent</span>
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-muted">{config.explanation}</p>
            <p className="mt-3 border-t border-line pt-3 text-[10px] leading-relaxed text-faint">
              Vergelijkingen gebruiken alleen gemeten dagen. Ontbrekende Garmin-data telt niet als nul.
            </p>
          </Card>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
