import { ArrowRight, ArrowUpRight, GitCompareArrows, Waves } from "lucide-react";
import { DetailDrawer } from "@/components/detail-drawer";
import { PlanGarminSync } from "@/components/plan-garmin-sync";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { duration } from "@/lib/format";
import type { PlanChange } from "@/lib/plan-comparison";
import type { Adjustment, Plan, PlanSession, PlanSyncLog, TrainingLoadSource } from "@/lib/queries";

const TRIGGER_LABEL: Record<string, string> = {
  goal_created: "Doel aangemaakt",
  goal_changed: "Doel gewijzigd",
  run_completed: "Run verwerkt",
  activity_completed: "Garmin-activiteit verwerkt",
  session_skipped: "Training gemist",
  weekly_review: "Wekelijkse review",
  alarm: "Herstelsignaal",
  manual: "Handmatige review",
};

const SPORT_LABEL: Record<string, string> = {
  running: "Hardlopen",
  cycling: "Fietsen",
  swimming: "Zwemmen",
  walking: "Wandelen",
  strength: "Kracht",
  other: "Andere sport",
};

function loadLabel(value: number | null) {
  if (value == null) return "geen loadmeting";
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1).replace(".", ",")} load`;
}

function dateTime(value: string) {
  return new Date(value).toLocaleDateString("nl-BE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PlanImpactCard({
  plan,
  previousPlan,
  changes,
  adjustments,
  source,
  sessions,
  sync,
}: {
  plan: Plan;
  previousPlan: Plan | null;
  changes: PlanChange[];
  adjustments: Adjustment[];
  source: TrainingLoadSource | null;
  sessions: PlanSession[];
  sync: PlanSyncLog | null;
}) {
  if (!previousPlan && plan.trigger === "goal_created" && !sync) return null;
  const triggerLabel = TRIGGER_LABEL[plan.trigger] ?? "Coachreview";
  const importantAdjustments = adjustments
    .filter((adjustment) => adjustment.severity !== "info")
    .slice(0, 3);
  const summary = changes[0]
    ? `${changes[0].label}: ${changes[0].before} → ${changes[0].after}`
    : "De coach heeft je schema beoordeeld; de planning hoefde niet te veranderen.";

  return (
    <DetailDrawer
      title="Plan bijgewerkt"
      subtitle={`Plan v${plan.version} · ${triggerLabel.toLowerCase()}`}
      triggerClassName="focus-ring block w-full rounded-card text-left"
      trigger={
        <Card className="surface-pressable border-line-strong p-4">
          <div className="flex items-start gap-3.5">
            <div className="grid size-10 shrink-0 place-items-center rounded-full bg-recovery/10 text-recovery">
              <GitCompareArrows className="size-[18px]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="label">Plan bijgewerkt</div>
                  <div className="mt-1.5 text-[15px] font-semibold text-ink">
                    {source ? `${SPORT_LABEL[source.sport] ?? "Activiteit"} verwerkt` : triggerLabel}
                  </div>
                </div>
                <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-faint" />
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted">{summary}</p>
              <Badge variant={changes.length ? "recovery" : "outline"} className="mt-2">
                {changes.length ? `${changes.length} ${changes.length === 1 ? "wijziging" : "wijzigingen"}` : "ongewijzigd"}
              </Badge>
            </div>
          </div>
        </Card>
      }
    >
      <div className="space-y-5 pt-3">
        {source ? (
          <Card className="border-recovery/25 bg-recovery/5 p-3.5">
            <div className="flex items-center gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-full bg-run-long/10 text-run-long">
                <Waves className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="label">Gebruikte Garmin-activiteit</div>
                <div className="mt-1 truncate text-[12px] font-semibold text-ink">
                  {source.name || SPORT_LABEL[source.sport] || "Activiteit"}
                </div>
                <div className="mt-0.5 text-[9px] text-faint">{dateTime(source.start_time_local)}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="numeral text-[14px] text-recovery">{loadLabel(source.load)}</div>
                <div className="mt-1 text-[9px] text-faint">{duration(source.duration_s)}</div>
              </div>
            </div>
          </Card>
        ) : null}

        <section>
          <div className="label mb-2">Oud tegenover nieuw</div>
          {changes.length ? (
            <div className="space-y-2">
              {changes.slice(0, 6).map((change) => (
                <div key={change.key} className="row p-3">
                  <div className="mb-2 text-[10px] font-semibold text-muted">{change.label}</div>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                    <span className="truncate text-[11px] leading-snug text-faint">{change.before}</span>
                    <ArrowRight className="size-3.5 text-recovery" />
                    <span className="truncate text-right text-[11px] font-semibold leading-snug text-ink">{change.after}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="row p-3 text-[11px] leading-relaxed text-muted">
              De nieuwe Garmin-data is beoordeeld, maar gaf geen reden om afstand, sessietype of trainingsdag te wijzigen.
            </div>
          )}
        </section>

        <section>
          <div className="label mb-2">Waarom</div>
          {importantAdjustments.length ? (
            <div className="space-y-2">
              {importantAdjustments.map((adjustment) => (
                <div key={adjustment.id} className="border-b border-line px-0.5 pb-3 last:border-0 last:pb-0">
                  <div className="flex items-center gap-2">
                    <Badge variant={adjustment.severity === "override" ? "danger" : "warning"}>
                      {adjustment.severity === "override" ? "veiligheid" : "begrenzing"}
                    </Badge>
                    <span className="truncate text-[9px] font-semibold text-faint">{adjustment.rule}</span>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted">{adjustment.explanation.nl}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] leading-relaxed text-muted">
              {plan.reason || "De coach heeft de nieuwe Garmin-data tegen je actieve regels en herstelstatus gelegd."}
            </p>
          )}
        </section>

        <PlanGarminSync
          plan={plan}
          previousPlan={previousPlan}
          sessions={sessions}
          initialSync={sync}
        />

        <div className="border-t border-line pt-3 text-[9px] leading-relaxed text-faint">
          Beoordeeld op {dateTime(plan.created_at)}. Hardloopvolume en belasting uit andere sporten blijven afzonderlijk berekend.
        </div>
      </div>
    </DetailDrawer>
  );
}
