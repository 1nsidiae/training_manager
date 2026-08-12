"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  ChevronRight,
  GitCompareArrows,
  LoaderCircle,
  Watch,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import { createClient } from "@/lib/supabase/client";
import type { PlanChange } from "@/lib/plan-comparison";
import type { Adjustment, Plan, PlanSession } from "@/lib/queries";

const TRIGGER_LABEL: Record<string, string> = {
  goal_created: "Nieuw doel",
  goal_changed: "Doel gewijzigd",
  run_completed: "Training en feedback verwerkt",
  activity_completed: "Garmin-activiteit verwerkt",
  session_skipped: "Training gemist",
  weekly_review: "Wekelijkse review",
  alarm: "Herstelsignaal",
  manual: "Handmatige review",
};

function severityMeta(severity: Adjustment["severity"]) {
  if (severity === "override") return { label: "Veiligheid", variant: "danger" as const };
  if (severity === "limit") return { label: "Begrenzing", variant: "warning" as const };
  return { label: "Onderbouwing", variant: "recovery" as const };
}

export function PlanApproval({
  plan,
  currentPlan,
  changes,
  adjustments,
  sessions,
}: {
  plan: Plan;
  currentPlan: Plan | null;
  changes: PlanChange[];
  adjustments: Adjustment[];
  sessions: PlanSession[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<"approve" | "reject" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const futureRuns = sessions.filter(
    (session) =>
      session.sport === "running" &&
      ["planned", "moved"].includes(session.status) &&
      session.session_type !== "rest",
  ).length;

  async function recordDecision(decision: "accepted" | "kept_original") {
    const now = new Date().toISOString();
    await createClient().from("sync_log").insert({
      sync_type: `plan_decision:${plan.id}:${decision}`,
      status: "ok",
      started_at: now,
      finished_at: now,
      items_synced: 0,
    });
  }

  async function approve() {
    setBusy("approve");
    setError(null);
    const sb = createClient();

    if (currentPlan) {
      const { error: demoteError } = await sb
        .from("plans")
        .update({ status: "superseded" })
        .eq("id", currentPlan.id)
        .eq("status", "active");
      if (demoteError) {
        setError("Je huidige plan kon niet veilig worden bewaard. Probeer opnieuw.");
        setBusy(null);
        return;
      }
    }

    const { error: activateError } = await sb
      .from("plans")
      .update({ status: "active" })
      .eq("id", plan.id)
      .eq("status", "proposed");
    if (activateError) {
      if (currentPlan) {
        await sb.from("plans").update({ status: "active" }).eq("id", currentPlan.id);
      }
      setError("Het nieuwe plan kon niet worden toegepast. Je oude plan blijft actief.");
      setBusy(null);
      return;
    }

    await recordDecision("accepted");
    const job = `plan_apply:${plan.id}:${currentPlan?.id ?? 0}`;
    const { error: jobError } = await sb
      .from("sync_log")
      .insert({ sync_type: job, status: "requested" });

    if (jobError && jobError.code !== "23505") {
      // Het plan is wel veilig actief. De impactkaart biedt daarna opnieuw
      // synchroniseren aan, dus een Garmin-storing draait de beslissing niet terug.
      await sb.from("plan_sessions").update({ push_error: "Garmin-update wacht op nieuwe poging" }).eq("plan_id", plan.id);
    }

    setOpen(false);
    setBusy(null);
    router.refresh();
  }

  async function keepOriginal() {
    setBusy("reject");
    setError(null);
    const { error: updateError } = await createClient()
      .from("plans")
      .update({ status: "superseded" })
      .eq("id", plan.id)
      .eq("status", "proposed");
    if (updateError) {
      setError("Je keuze kon niet worden opgeslagen. Probeer opnieuw.");
      setBusy(null);
      return;
    }
    await recordDecision("kept_original");
    setOpen(false);
    setBusy(null);
    router.refresh();
  }

  const preview = changes.slice(0, 2);

  return (
    <>
      <section className="card-insight overflow-hidden border-warning/25" aria-labelledby={`plan-proposal-${plan.id}`}>
        <div className="px-4 pb-3 pt-4">
          <div className="flex items-start gap-3.5">
            <div className="grid size-10 shrink-0 place-items-center rounded-full bg-warning/10 text-warning">
              <GitCompareArrows className="size-[18px]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id={`plan-proposal-${plan.id}`} className="text-[15px] font-semibold">
                  Je plan kan worden aangepast
                </h2>
                <Badge variant="warning">Jouw keuze</Badge>
              </div>
              <p className="mt-1 text-[11px] font-medium text-faint">
                Plan v{plan.version} · {TRIGGER_LABEL[plan.trigger] ?? "Coachreview"}
              </p>
            </div>
          </div>

          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            {plan.reason || "De coach stelt een andere trainingsbelasting voor op basis van je recente gegevens."}
          </p>
        </div>

        {preview.length ? (
          <div className="border-y border-line bg-canvas/25 px-4 py-1">
            {preview.map((change) => (
              <div key={change.key} className="grid grid-cols-[1fr_auto] gap-3 border-b border-line py-2.5 last:border-0">
                <div className="min-w-0">
                  <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-faint">{change.label}</div>
                  <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px]">
                    <span className="truncate text-faint">{change.before}</span>
                    <ArrowRight className="size-3 shrink-0 text-warning" />
                    <span className="truncate font-semibold text-ink">{change.after}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {error ? <p className="px-4 pt-3 text-[11px] text-danger" role="alert">{error}</p> : null}

        <div className="grid grid-cols-[1fr_1.25fr] gap-2 p-3">
          <Button variant="secondary" onClick={() => setOpen(true)} disabled={busy !== null}>
            Details <ChevronRight />
          </Button>
          <Button onClick={approve} disabled={busy !== null}>
            {busy === "approve" ? <LoaderCircle className="animate-spin" /> : <Check />}
            Toepassen
          </Button>
        </div>
        <button
          type="button"
          className="focus-ring min-h-10 w-full border-t border-line text-[10px] font-semibold text-faint transition-colors hover:text-ink"
          onClick={keepOriginal}
          disabled={busy !== null}
        >
          {busy === "reject" ? "Even opslaan…" : "Origineel plan behouden"}
        </button>
      </section>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <div className="border-b border-line px-4 pb-3 pt-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <DrawerTitle className="text-[18px] font-semibold tracking-[-0.025em]">
                  Voorgestelde aanpassing
                </DrawerTitle>
                <DrawerDescription className="mt-1 text-[11px] text-faint">
                  Plan v{currentPlan?.version ?? "–"} tegenover v{plan.version}
                </DrawerDescription>
              </div>
              <Badge variant="warning">Wacht op jou</Badge>
            </div>
          </div>

          <div className="overflow-y-auto px-4 pb-6 pt-4">
            <section>
              <div className="label">Waarom nu</div>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">
                {plan.reason || "Je recente training en herstelgegevens geven aanleiding om de komende weken aan te passen."}
              </p>
            </section>

            <section className="mt-5">
              <div className="mb-2 flex items-center justify-between">
                <div className="label">Oud tegenover nieuw</div>
                <Badge variant="outline">{changes.length} wijzigingen</Badge>
              </div>
              <div className="space-y-2">
                {changes.length ? changes.map((change) => (
                  <div key={change.key} className="rounded-[16px] border border-line bg-s2/55 p-3">
                    <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-faint">{change.label}</div>
                    <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                      <span className="text-[11px] leading-snug text-faint">{change.before}</span>
                      <ArrowRight className="size-3.5 text-warning" />
                      <span className="text-right text-[11px] font-semibold leading-snug text-ink">{change.after}</span>
                    </div>
                  </div>
                )) : (
                  <div className="rounded-[16px] border border-line bg-s2/45 p-3 text-[11px] leading-relaxed text-muted">
                    De inhoud bleef gelijk; alleen de onderbouwing van het plan is opnieuw beoordeeld.
                  </div>
                )}
              </div>
            </section>

            {adjustments.length ? (
              <section className="mt-5">
                <div className="label mb-2">Regels die meespeelden</div>
                <div className="divide-y divide-line rounded-[16px] border border-line px-3">
                  {adjustments.slice(0, 5).map((adjustment) => {
                    const meta = severityMeta(adjustment.severity);
                    return (
                      <div key={adjustment.id} className="py-3">
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                        <p className="mt-2 text-[11px] leading-relaxed text-muted">{adjustment.explanation.nl}</p>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <div className="mt-5 flex items-center gap-3 rounded-[16px] border border-recovery/20 bg-recovery/5 p-3">
              <Watch className="size-4 shrink-0 text-recovery" />
              <p className="text-[10px] leading-relaxed text-muted">
                Na toepassen wordt het plan actief en worden {futureRuns} toekomstige loopsessies in één gecontroleerde taak naar Garmin gestuurd.
              </p>
            </div>

            {error ? <p className="mt-3 text-[11px] text-danger" role="alert">{error}</p> : null}

            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={keepOriginal} disabled={busy !== null}>
                {busy === "reject" ? <LoaderCircle className="animate-spin" /> : <X />}
                Behouden
              </Button>
              <Button onClick={approve} disabled={busy !== null}>
                {busy === "approve" ? <LoaderCircle className="animate-spin" /> : <Check />}
                Toepassen
              </Button>
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
