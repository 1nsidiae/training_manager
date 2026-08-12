import { CoachRuleRow } from "@/components/coach-rule-row";
import { PlanWeekCard } from "@/components/plan-week-card";
import { PlanApproval } from "@/components/plan-approval";
import { PlanHistoryCard } from "@/components/plan-history-card";
import { PlanSessionRow, WeekBlocks } from "@/components/plan-session-row";
import { ScreenHeader } from "@/components/screen-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { comparePlans } from "@/lib/plan-comparison";
import {
  getActivePlan,
  getAdjustments,
  getGoal,
  getPlanSessions,
  getPlanHistory,
  getProposedPlan,
  type PlanSession,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

const SEVERITY = {
  override: {
    label: "Veiligheid",
    drawerTitle: "Veiligheidsgreep",
    cls: "text-danger border-danger/40",
    tone: "danger",
  },
  limit: {
    label: "Begrenzing",
    drawerTitle: "Plan begrensd",
    cls: "text-warning border-warning/40",
    tone: "warning",
  },
  info: {
    label: "Onderbouwing",
    drawerTitle: "Onderbouwing",
    cls: "text-recovery border-recovery/40",
    tone: "recovery",
  },
} as const;

const EVIDENCE_LABEL: Record<string, string> = {
  days_since_last_run: "Dagen sinds laatste run",
  inactive_days: "Drempel inactiviteit",
  threshold: "Drempel",
  threshold_h: "Drempel slaap",
  sleep_7d_avg_h: "Gemiddelde slaap (7 dagen)",
  readiness: "Training Readiness",
  max_increase_pct: "Maximale weekgroei",
  planned_distance_m: "Geplande afstand",
  reference_distance_m: "Referentieafstand",
};

function evidenceLabel(key: string) {
  return EVIDENCE_LABEL[key] ?? key.replaceAll("_", " ");
}

function evidenceValue(value: unknown) {
  if (typeof value === "boolean") return value ? "Ja" : "Nee";
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function mondayOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export default async function PlanPage() {
  const [plan, goal, proposed] = await Promise.all([
    getActivePlan(),
    getGoal(),
    getProposedPlan(),
  ]);

  if (!plan) {
    return (
      <main className="space-y-5">
        <ScreenHeader eyebrow="Trainingsblok" title="Plan" />
        <Card className="p-4 text-sm text-muted">Nog geen actief plan.</Card>
      </main>
    );
  }

  const [sessions, adjustments, proposedSessions, proposedAdjustments, planHistory] = await Promise.all([
    getPlanSessions(plan.id),
    getAdjustments(plan.id),
    proposed ? getPlanSessions(proposed.id) : Promise.resolve([]),
    proposed ? getAdjustments(proposed.id) : Promise.resolve([]),
    getPlanHistory(plan.goal_id),
  ]);
  const proposedChanges = comparePlans(proposedSessions, sessions);

  const weeks = new Map<string, PlanSession[]>();
  for (const s of sessions) {
    const key = mondayOf(s.day);
    weeks.set(key, [...(weeks.get(key) ?? []), s]);
  }
  const weekList = [...weeks.entries()];
  const thisWeek = mondayOf(new Date().toISOString().slice(0, 10));
  const currentIndex = Math.max(weekList.findIndex(([w]) => w === thisWeek), 0);

  const planLevel = adjustments.filter((a) => a.plan_session_id == null);
  const lastWeekStart = weekList.at(-1)?.[0];

  return (
    <main className="space-y-5">
      {proposed ? (
        <PlanApproval
          plan={proposed}
          currentPlan={plan}
          changes={proposedChanges}
          adjustments={proposedAdjustments}
          sessions={proposedSessions}
        />
      ) : null}

      <ScreenHeader
        eyebrow={`Plan v${plan.version}`}
        title="Jouw trainingsplan"
        description="Je volledige blok, de reden achter aanpassingen en wat er deze week moet gebeuren."
        action={<Badge variant="teal" className="mt-1">actief</Badge>}
      />

      <PlanHistoryCard plans={planHistory} />

      {/* Doel: waar werk je naartoe */}
      {goal && (
        <Card className="border-line-strong p-4">
          <div className="flex items-baseline justify-between">
            <span className="label">Doel</span>
            <span className="numeral text-[11px] font-medium text-faint">
              nog {weekList.length - currentIndex} weken in dit blok
            </span>
          </div>
          <h2 className="mt-2 text-[17px]">{goal.name}</h2>
          <p className="mt-1.5 text-xs leading-[1.5] text-muted">{plan.summary}</p>

          <Progress
            value={((currentIndex + 1) / Math.max(weekList.length, 1)) * 100}
            indicatorClassName="bg-strain"
            className="mt-3.5"
          />
          <div className="mt-2 flex justify-between">
            <span className="numeral text-[10px] font-medium text-ink">
              Week {currentIndex + 1}
            </span>
            <span className="numeral text-[10px] font-medium text-faint">
              Week {weekList.length}
              {lastWeekStart ? ` · ${lastWeekStart.slice(8)}-${lastWeekStart.slice(5, 7)}` : ""}
            </span>
          </div>
        </Card>
      )}

      {weekList.map(([weekStart, list], i) => {
        const weekKm = list.reduce((n, s) => n + (s.planned_distance_m ?? 0), 0) / 1000;
        const prevKm =
          i > 0
            ? weekList[i - 1][1].reduce((n, s) => n + (s.planned_distance_m ?? 0), 0) / 1000
            : null;
        const delta = prevKm ? ((weekKm - prevKm) / prevKm) * 100 : null;
        const isCurrent = weekStart === thisWeek;
        const weekAdjustments = adjustments.filter((a) =>
          list.some((s) => s.id === a.plan_session_id),
        );

        return (
          <PlanWeekCard
            key={weekStart}
            defaultOpen={isCurrent}
            preview={<WeekBlocks sessions={list} />}
            header={
              <div className="flex items-center justify-between gap-3 pr-1">
                <div className="flex items-baseline gap-2">
                <span
                  className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${
                    isCurrent ? "text-ink" : "text-faint"
                  }`}
                >
                  Week {i + 1}
                </span>
                {isCurrent ? <Badge variant="teal" className="h-5 px-2">deze week</Badge> : null}
              </div>
              <div className="flex items-baseline gap-2">
                {delta != null && (
                  <span className="numeral text-[10px] font-medium text-faint">
                    {delta >= 0 ? "+" : ""}
                    {delta.toFixed(0)}%
                  </span>
                )}
                <span className="numeral text-[13px] font-bold tracking-[-0.03em]">
                  {weekKm.toFixed(1)}
                  <span className="ml-0.5 text-[10px] font-normal text-faint">km</span>
                </span>
              </div>
              </div>
            }
          >
              <div className="flex flex-col gap-1.5">
                {list.map((s) => (
                  <PlanSessionRow key={s.id} session={s} />
                ))}
              </div>

            {weekAdjustments.length > 0 && (
              <div className="mt-3 space-y-2 border-t border-line pt-3">
                {weekAdjustments.map((a) => {
                  const sev = SEVERITY[a.severity] ?? SEVERITY.info;
                  return (
                    <div key={a.id} className="flex items-start gap-2.5">
                      <span
                        className={`shrink-0 rounded-full border px-2 py-[3px] text-[10px] font-medium ${sev.cls}`}
                      >
                        {sev.label}
                      </span>
                      <p className="text-[11px] leading-[1.5] text-muted">
                        {a.explanation.nl}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </PlanWeekCard>
        );
      })}

      {planLevel.length > 0 && (
        <section>
          <div className="label mb-2">Waarom dit plan zo is</div>
          <div className="space-y-1.5">
            {planLevel.map((a) => {
              const sev = SEVERITY[a.severity] ?? SEVERITY.info;
              return (
                <CoachRuleRow
                  key={a.id}
                  eyebrow={sev.label}
                  title={a.explanation.nl}
                  tone={sev.tone}
                  drawerTitle={sev.drawerTitle}
                  drawerSubtitle="Waarom deze keuze in je plan zit"
                >
                  <p className="text-[13px] leading-relaxed text-muted">
                    {a.explanation.nl}
                  </p>
                  {Object.keys(a.evidence).length > 0 && (
                    <div className="mt-4">
                      <div className="label mb-2">Bewijs</div>
                      <div className="space-y-1">
                        {Object.entries(a.evidence).map(([k, v]) => (
                          <div
                            key={k}
                            className="row flex items-center justify-between px-3 py-2"
                          >
                            <span className="text-[11px] capitalize text-muted">
                              {evidenceLabel(k)}
                            </span>
                            <span className="numeral text-[13px] font-semibold">
                              {evidenceValue(v)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CoachRuleRow>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
