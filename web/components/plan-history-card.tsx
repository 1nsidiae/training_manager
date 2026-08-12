import { ArrowUpRight, History } from "lucide-react";
import { DetailDrawer } from "@/components/detail-drawer";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { Plan } from "@/lib/queries";

const TRIGGER_LABEL: Record<string, string> = {
  goal_created: "Doel aangemaakt",
  goal_changed: "Doel gewijzigd",
  run_completed: "Training verwerkt",
  activity_completed: "Garmin-activiteit verwerkt",
  session_skipped: "Training gemist",
  weekly_review: "Wekelijkse review",
  alarm: "Herstelsignaal",
  manual: "Handmatige review",
};

function dateTime(value: string) {
  return new Intl.DateTimeFormat("nl-BE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function status(plan: Plan) {
  if (plan.status === "active") return { label: "Actief", variant: "teal" as const };
  if (plan.status === "proposed") return { label: "Wacht op keuze", variant: "warning" as const };
  return { label: "Eerdere versie", variant: "outline" as const };
}

export function PlanHistoryCard({ plans }: { plans: Plan[] }) {
  if (plans.length < 2) return null;
  return (
    <DetailDrawer
      title="Planversies"
      subtitle="Wat de coach voorstelde en welk schema nu geldt"
      triggerClassName="focus-ring block w-full rounded-card text-left"
      trigger={
        <Card className="surface-pressable flex items-center gap-3 border-line-strong p-3.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-s2 text-muted">
            <History className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-semibold text-ink">Planversies</span>
            <span className="mt-0.5 block text-[10px] text-faint">
              {plans.length} bewaarde versies · huidig plan v{plans.find((plan) => plan.status === "active")?.version ?? "–"}
            </span>
          </span>
          <ArrowUpRight className="size-4 text-faint" />
        </Card>
      }
    >
      <div className="space-y-2 pt-3">
        {plans.map((plan) => {
          const meta = status(plan);
          return (
            <article key={plan.id} className="rounded-[16px] border border-line bg-s2/45 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[12px] font-semibold text-ink">Plan v{plan.version}</div>
                  <div className="mt-1 text-[9px] font-semibold text-faint">
                    {TRIGGER_LABEL[plan.trigger] ?? "Coachreview"} · {dateTime(plan.created_at)}
                  </div>
                </div>
                <Badge variant={meta.variant}>{meta.label}</Badge>
              </div>
              {plan.reason ? (
                <p className="mt-2 line-clamp-3 text-[10px] leading-relaxed text-muted">{plan.reason}</p>
              ) : null}
            </article>
          );
        })}
      </div>
    </DetailDrawer>
  );
}
