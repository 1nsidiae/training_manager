import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  ClipboardCheck,
  Gauge,
  HeartPulse,
  MoonStar,
} from "lucide-react";
import { DetailDrawer } from "@/components/detail-drawer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DrawerClose } from "@/components/ui/drawer";
import { trainingLoadSportLabel } from "@/lib/training-load";
import type { WeeklyReview, WeeklyReviewTone } from "@/lib/weekly-review";

const TONE: Record<WeeklyReviewTone, { text: string; icon: string; rule: string }> = {
  recovery: { text: "text-recovery", icon: "bg-recovery/10 text-recovery", rule: "bg-recovery" },
  warning: { text: "text-warning", icon: "bg-warning/10 text-warning", rule: "bg-warning" },
  danger: { text: "text-danger", icon: "bg-danger/10 text-danger", rule: "bg-danger" },
  info: { text: "text-run-easy", icon: "bg-run-easy/10 text-run-easy", rule: "bg-run-easy" },
};

function periodLabel(fromDay: string, throughDay: string) {
  const from = new Date(`${fromDay}T12:00:00Z`);
  const through = new Date(`${throughDay}T12:00:00Z`);
  const fromLabel = from.toLocaleDateString("nl-BE", { day: "numeric", month: "short" });
  const throughLabel = through.toLocaleDateString("nl-BE", { day: "numeric", month: "short" });
  return `${fromLabel}–${throughLabel}`;
}

function km(value: number) {
  return `${(value / 1000).toFixed(1).replace(".", ",")} km`;
}

function hours(value: number | null) {
  return value == null ? "—" : `${(value / 3600).toFixed(1).replace(".", ",")} u`;
}

function decimal(value: number | null, suffix = "") {
  return value == null ? "—" : `${value.toFixed(1).replace(".", ",")}${suffix}`;
}

function loadValue(value: number) {
  return value.toFixed(value >= 100 ? 0 : 1).replace(".", ",");
}

export function WeeklyReviewCard({
  review,
  proposalReady = false,
}: {
  review: WeeklyReview;
  proposalReady?: boolean;
}) {
  const tone = TONE[review.tone];
  const period = periodLabel(review.fromDay, review.throughDay);

  return (
    <DetailDrawer
      title="Wekelijkse review"
      subtitle={`${period} · Garmin, planning en jouw feedback`}
      triggerClassName="focus-ring block w-full rounded-card text-left"
      trigger={
        <Card className="surface-pressable border-line-strong p-4">
          <div className="flex items-start gap-3.5">
            <div className={`grid size-10 shrink-0 place-items-center rounded-full ${tone.icon}`}>
              <ClipboardCheck className="size-[18px]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="label">Wekelijkse review · {period}</div>
                  <h2 className={`mt-1.5 text-[16px] font-semibold tracking-[-0.02em] ${tone.text}`}>
                    {proposalReady ? "Nieuw voorstel klaar" : review.title}
                  </h2>
                </div>
                <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-faint" />
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                {proposalReady
                  ? "De coach heeft de afgeronde week beoordeeld. Jij beslist of het plan verandert."
                  : review.summary}
              </p>
              <div className="mt-3 flex items-center gap-2.5 text-[10px] font-semibold text-faint">
                <span className={`h-1.5 w-8 rounded-full ${tone.rule}`} />
                <span>
                  {review.completedSessions}/{review.dueSessions || review.plannedSessions} sessies
                </span>
                <span aria-hidden="true">·</span>
                <span>{km(review.actualRunDistanceM)} gelopen</span>
              </div>
            </div>
          </div>
        </Card>
      }
    >
      <div className="space-y-5 pt-3">
        <section>
          <div className="label">Coachbesluit</div>
          <h3 className={`mt-2 text-[20px] font-semibold tracking-[-0.025em] ${tone.text}`}>
            {proposalReady ? "Voorstel wacht op jouw keuze" : review.title}
          </h3>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            {proposalReady
              ? "De review heeft een aanpassing opgeleverd. Het huidige plan blijft actief totdat jij het voorstel goedkeurt."
              : review.decision}
          </p>
        </section>

        <section>
          <div className="label mb-2">Uitvoering</div>
          <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-line bg-s2">
            <ReviewMetric
              icon={<ClipboardCheck />}
              label="Sessies"
              value={`${review.completedSessions}/${review.dueSessions || review.plannedSessions}`}
            />
            <ReviewMetric icon={<Activity />} label="Gelopen" value={km(review.actualRunDistanceM)} />
            <ReviewMetric
              icon={<Gauge />}
              label="Gepland"
              value={km(review.plannedRunDistanceM)}
              last
            />
          </div>
          {review.otherActivities ? (
            <p className="mt-2.5 text-[10px] leading-relaxed text-faint">
              Daarnaast {review.otherActivities} {review.otherActivities === 1 ? "andere Garmin-activiteit" : "andere Garmin-activiteiten"}
              {review.otherActivityDurationS ? ` · ${hours(review.otherActivityDurationS)}` : ""}. Die tellen mee als herstelcontext, niet als hardloopkilometers.
            </p>
          ) : null}
        </section>

        <section>
          <div className="label mb-2">Belastingsmix · alle sporten</div>
          <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-line bg-s2">
            <ReviewMetric icon={<Gauge />} label="Acute · 7d" value={loadValue(review.acuteLoad)} />
            <ReviewMetric icon={<Activity />} label="Chronisch · 28d" value={loadValue(review.chronicLoad)} />
            <ReviewMetric
              icon={<HeartPulse />}
              label="Ratio"
              value={review.acwr == null ? "—" : review.acwr.toFixed(2).replace(".", ",")}
              last
            />
          </div>
          {review.loadSports.length ? (
            <div className="mt-2 divide-y divide-line border-y border-line">
              {review.loadSports.slice(0, 4).map((sport) => (
                <div key={sport.sport} className="flex items-center justify-between gap-3 py-2.5 text-[11px]">
                  <div className="min-w-0">
                    <span className="font-semibold text-ink">{trainingLoadSportLabel(sport.sport)}</span>
                    <span className="ml-1.5 text-faint">
                      {sport.sessions} {sport.sessions === 1 ? "sessie" : "sessies"}
                      {sport.estimatedSessions ? ` · ${sport.estimatedSessions} geschat` : ""}
                    </span>
                  </div>
                  <span className="numeral shrink-0 text-[14px] text-run-easy">{loadValue(sport.load)}</span>
                </div>
              ))}
            </div>
          ) : null}
          <p className="mt-2.5 text-[10px] leading-relaxed text-faint">
            {review.heavyRunImpact === "protect"
              ? "Recente belasting uit andere sporten vraagt 24–48 uur ruimte vóór een zware run."
              : review.heavyRunImpact === "watch"
                ? "De coach bewaakt extra herstelruimte vóór de volgende zware run."
                : "De recente multi-sportbelasting vraagt momenteel geen extra bescherming van een zware run."}
            {` Datakwaliteit: ${review.loadDataQuality === "measured" ? "gemeten" : review.loadDataQuality === "mixed" ? "gemeten en geschat" : review.loadDataQuality === "estimated" ? "geschat op duur" : "nog onvoldoende"}.`}
          </p>
        </section>

        <section>
          <div className="label mb-2">Hoe het voelde</div>
          {review.feedbackCount ? (
            <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-line bg-s2">
              <ReviewMetric icon={<Gauge />} label="RPE" value={decimal(review.avgRpe, "/10")} />
              <ReviewMetric icon={<HeartPulse />} label="Max. pijn" value={decimal(review.maxPain, "/10")} />
              <ReviewMetric icon={<Activity />} label="Conditie" value={decimal(review.avgEndurance, "/10")} last />
            </div>
          ) : (
            <div className="row px-3 py-3 text-[11px] leading-relaxed text-muted">
              Nog geen feedback in deze week. Na een training kost dit ongeveer vijf seconden en maakt het coachbesluit betrouwbaarder.
            </div>
          )}
        </section>

        <section>
          <div className="label mb-2">Herstelcontext</div>
          <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-line bg-s2">
            <ReviewMetric icon={<MoonStar />} label="Slaap" value={hours(review.avgSleepS)} />
            <ReviewMetric
              icon={<Gauge />}
              label="Fitheid"
              value={review.avgReadiness == null ? "—" : String(Math.round(review.avgReadiness))}
            />
            <ReviewMetric
              icon={<HeartPulse />}
              label="HRV-signaal"
              value={review.hrvUnbalancedDays ? `${review.hrvUnbalancedDays} d` : "In balans"}
              last
            />
          </div>
          <p className="mt-2.5 text-[10px] text-faint">
            Gebaseerd op {review.wellnessDays} {review.wellnessDays === 1 ? "Garmin-dag" : "Garmin-dagen"} in deze periode.
          </p>
        </section>

        {review.evidence.length ? (
          <section>
            <div className="label mb-2">Bewijs</div>
            <div className="divide-y divide-line border-y border-line">
              {review.evidence.map((item) => (
                <div key={item} className="flex items-center gap-2.5 py-2.5 text-[11px] text-muted">
                  <span className={`size-1.5 shrink-0 rounded-full ${tone.rule}`} />
                  {item}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {proposalReady ? (
          <DrawerClose asChild>
            <Button asChild className="w-full">
              <Link href="#weekly-plan-proposal">Voorstel bekijken</Link>
            </Button>
          </DrawerClose>
        ) : (
          <div className="border-t border-line pt-3 text-[9px] leading-relaxed text-faint">
            De automatische weekreview draait op zondag. Een wijziging wordt altijd eerst als voorstel getoond en nooit zonder jouw akkoord toegepast.
          </div>
        )}
      </div>
    </DetailDrawer>
  );
}

function ReviewMetric({
  icon,
  label,
  value,
  last = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div className={`min-w-0 px-3 py-3 ${last ? "" : "border-r border-line"}`}>
      <div className="flex items-center gap-1.5 text-[9px] font-medium text-faint [&_svg]:size-3">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="numeral mt-1.5 truncate text-[15px] font-semibold text-ink">{value}</div>
    </div>
  );
}
