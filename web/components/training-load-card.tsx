import { ArrowUpRight, Gauge } from "lucide-react";
import { DetailDrawer } from "@/components/detail-drawer";
import { InteractiveBarChart, type InteractiveBarDatum } from "@/components/interactive-bar-chart";
import { Card } from "@/components/ui/card";
import { MetricDelta, type MetricDeltaDirection, type MetricDeltaTone } from "@/components/ui/metric-delta";
import { duration } from "@/lib/format";
import type { TrainingLoadSummary } from "@/lib/queries";
import { trainingLoadSportLabel } from "@/lib/training-load";
import { cn } from "@/lib/utils";

const SPORT_META: Record<string, { label: string; color: string; text: string }> = {
  running: { label: "Hardlopen", color: "#0093e7", text: "text-strain" },
  cycling: { label: "Fietsen", color: "#7f86ff", text: "text-run-cross" },
  swimming: { label: "Zwemmen", color: "#00bdd6", text: "text-run-long" },
  walking: { label: "Wandelen", color: "#00f19f", text: "text-teal" },
  strength: { label: "Kracht", color: "#ff6257", text: "text-run-strength" },
  hiking: { label: "Hiken", color: "#00d6a3", text: "text-teal" },
  racquet: { label: "Racketsport", color: "#ff9d3d", text: "text-warning" },
  team_sport: { label: "Teamsport", color: "#ff7a59", text: "text-run-strength" },
  rowing: { label: "Roeien & peddelen", color: "#33c6c8", text: "text-run-long" },
  winter_sport: { label: "Wintersport", color: "#9cc9ff", text: "text-recovery" },
  yoga: { label: "Yoga & mobiliteit", color: "#b99cff", text: "text-run-cross" },
  other: { label: "Overig", color: "#67aee6", text: "text-recovery" },
};

function loadLabel(value: number) {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1).replace(".", ",");
}

function dayLabel(day: string) {
  return new Date(`${day}T12:00:00`).toLocaleDateString("nl-BE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function comparison(summary: TrainingLoadSummary) {
  if (summary.deltaPct == null) {
    return summary.currentLoad > 0
      ? { label: "Eerste belasting in 14 dagen", tone: "info" as MetricDeltaTone, direction: "up" as MetricDeltaDirection }
      : { label: "Geen belasting in 7 dagen", tone: "neutral" as MetricDeltaTone, direction: "flat" as MetricDeltaDirection };
  }
  if (summary.deltaPct > 20) {
    return { label: `+${summary.deltaPct}% vs vorige 7d`, tone: "warning" as MetricDeltaTone, direction: "up" as MetricDeltaDirection };
  }
  if (summary.deltaPct > 0) {
    return { label: `+${summary.deltaPct}% vs vorige 7d`, tone: "info" as MetricDeltaTone, direction: "up" as MetricDeltaDirection };
  }
  if (summary.deltaPct < 0) {
    return { label: `${summary.deltaPct}% vs vorige 7d`, tone: "recovery" as MetricDeltaTone, direction: "down" as MetricDeltaDirection };
  }
  return { label: "Gelijk aan vorige 7d", tone: "neutral" as MetricDeltaTone, direction: "flat" as MetricDeltaDirection };
}

export function TrainingLoadCard({ summary }: { summary: TrainingLoadSummary }) {
  const delta = comparison(summary);
  const totalSportLoad = summary.sports.reduce((sum, sport) => sum + sport.load, 0);
  const visibleDays = summary.days.slice(-14);
  const chartData: InteractiveBarDatum[] = visibleDays.map((day, index) => ({
    id: day.day,
    eyebrow: index < 7 ? "Vorige periode" : "Huidige periode",
    dateLabel: dayLabel(day.day),
    valueLabel: `${loadLabel(day.load)} load`,
    value: day.load,
    color: index < 7 ? "#586267" : "#0093e7",
    axisLabel: index % 2 === 0 ? day.day.slice(8) : "",
    muted: day.load === 0,
  }));
  const dailyAverage = summary.currentLoad / 7;
  const impact = {
    clear: { label: "Ruimte voor zware run", text: "text-recovery", detail: "Geen recente niet-loopbelasting die extra herstelruimte vraagt." },
    watch: { label: "Herstelruimte bewaken", text: "text-warning", detail: "Recente belasting uit andere sporten telt mee vóór je volgende zware run." },
    protect: { label: "Zware run beschermen", text: "text-danger", detail: "Plan 24–48 uur ruimte na de recente mechanische of aerobe belasting." },
  }[summary.heavyRunImpact];
  const qualityLabel = {
    measured: "Garmin/HR gemeten",
    mixed: "Gemeten + geschat",
    estimated: "Op duur geschat",
    missing: "Nog geen brondata",
  }[summary.dataQuality];

  return (
    <DetailDrawer
      title="Trainingsbelasting"
      subtitle={`Alle sporten · ${qualityLabel}`}
      triggerClassName="focus-ring block w-full rounded-card text-left"
      trigger={
        <Card className="surface-pressable border-line-strong p-4">
          <div className="flex items-start gap-3.5">
            <div className="grid size-10 shrink-0 place-items-center rounded-full bg-strain/10 text-strain">
              <Gauge className="size-[18px]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="label">Trainingsbelasting · 7 dagen</div>
                  <div className="mt-1.5 flex items-baseline gap-2">
                    <span className="numeral text-[27px] font-bold text-ink">{loadLabel(summary.currentLoad)}</span>
                    <span className="text-[10px] font-semibold text-faint">load</span>
                  </div>
                </div>
                <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-faint" />
              </div>
              <MetricDelta direction={delta.direction} tone={delta.tone} className="mt-2">
                {delta.label}
              </MetricDelta>
              {summary.heavyRunImpact !== "clear" ? (
                <div className={`mt-2 text-[10px] font-semibold ${impact.text}`}>{impact.label}</div>
              ) : null}
            </div>
          </div>

          {totalSportLoad > 0 ? (
            <div className="mt-4">
              <div className="flex h-2 gap-px overflow-hidden rounded-full bg-s3/60">
                {summary.sports.map((sport) => (
                  <div
                    key={sport.sport}
                    style={{
                      width: `${(sport.load / totalSportLoad) * 100}%`,
                      background: SPORT_META[sport.sport]?.color ?? SPORT_META.other.color,
                    }}
                  />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {summary.sports.slice(0, 3).map((sport) => (
                  <span key={sport.sport} className="flex items-center gap-1.5 text-[9px] font-semibold text-faint">
                    <span
                      className="size-1.5 rounded-full"
                      style={{ background: SPORT_META[sport.sport]?.color ?? SPORT_META.other.color }}
                    />
                    {trainingLoadSportLabel(sport.sport)} {Math.round((sport.load / totalSportLoad) * 100)}%
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-[11px] leading-relaxed text-muted">
              Er staat nog geen activiteit in deze periode. Je volgende Garmin-sync vult dit automatisch aan.
            </p>
          )}
        </Card>
      }
    >
      <div className="space-y-4 pt-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="row p-3">
            <div className="micro">Acute · 7d</div>
            <div className="numeral mt-1.5 text-[22px] text-strain">{loadLabel(summary.currentLoad)}</div>
          </div>
          <div className="row p-3">
            <div className="micro">Chronisch · 28d</div>
            <div className="numeral mt-1.5 text-[22px] text-recovery">{loadLabel(summary.chronicLoad)}</div>
          </div>
          <div className="row p-3">
            <div className="micro">Ratio</div>
            <div className="numeral mt-1.5 text-[22px] text-muted">
              {summary.acwr == null ? "—" : summary.acwr.toFixed(2).replace(".", ",")}
            </div>
          </div>
        </div>

        <div className="row flex items-start justify-between gap-4 p-3">
          <div>
            <div className="micro">Impact op zware run</div>
            <div className={cn("mt-1 text-[12px] font-semibold", impact.text)}>{impact.label}</div>
            <p className="mt-1 text-[10px] leading-relaxed text-muted">{impact.detail}</p>
          </div>
          <div className="shrink-0 text-right">
            <div className="micro">Datakwaliteit</div>
            <div className="mt-1 text-[10px] font-semibold text-ink">{qualityLabel}</div>
          </div>
        </div>

        <Card className="p-3.5">
          <InteractiveBarChart
            data={chartData}
            ariaLabel="Garmin Training Load per dag; tik op een balk voor de datum en waarde"
            average={dailyAverage > 0 ? {
              value: dailyAverage,
              label: `Huidig daggemiddelde ${loadLabel(dailyAverage)}`,
              color: "#67aee6",
            } : undefined}
          />
        </Card>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <div className="label">Bijdrage per sport</div>
            <span className="text-[10px] font-medium text-faint">{duration(summary.currentDurationS)} totaal</span>
          </div>
          {summary.sports.length ? (
            <div className="space-y-2">
              {summary.sports.map((sport) => {
                const meta = SPORT_META[sport.sport] ?? SPORT_META.other;
                return (
                  <div key={sport.sport} className="row flex items-center gap-3 px-3 py-2.5">
                    <span className="size-2 rounded-full" style={{ background: meta.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-semibold text-ink">{trainingLoadSportLabel(sport.sport)}</div>
                      <div className="mt-0.5 text-[9px] text-faint">
                        {sport.sessions} {sport.sessions === 1 ? "activiteit" : "activiteiten"} · {duration(sport.duration_s)}
                        {sport.estimatedSessions > 0 ? ` · ${sport.estimatedSessions} op duur geschat` : ""}
                      </div>
                    </div>
                    <div className={cn("numeral text-[16px]", meta.text)}>{loadLabel(sport.load)}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="row p-3 text-[11px] leading-relaxed text-muted">Geen activiteiten in de huidige periode.</div>
          )}
        </section>

        <p className="border-t border-line pt-3 text-[10px] leading-relaxed text-faint">
          Hardloopkilometers sturen alleen je loopvolume. De belasting van iedere Garmin-sport — ook padel of een nieuw, onbekend sporttype — telt mee voor herstel en de plaatsing van zware runs. Schattingen worden altijd als schatting getoond.
        </p>
      </div>
    </DetailDrawer>
  );
}
