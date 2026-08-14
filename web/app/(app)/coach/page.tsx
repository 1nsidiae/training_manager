import { CoachRuleRow } from "@/components/coach-rule-row";
import { CoachChat } from "@/components/coach-chat";
import { AppTopBar } from "@/components/app-top-bar";
import { ScreenHeader } from "@/components/screen-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bot, ShieldCheck } from "lucide-react";
import { getCoachMessages, getCoachRuns, getRules } from "@/lib/queries";

export const dynamic = "force-dynamic";

const CLASSES = {
  core: {
    title: "Kernregels",
    label: "Vast",
    blurb:
      "Niet wijzigbaar door de coach. Deze veiligheidsregels worden buiten het AI-model afgedwongen.",
    tone: "danger",
  },
  tunable: {
    title: "Bij te stellen",
    label: "Datagestuurd",
    blurb:
      "Drempels mogen alleen binnen een veilige band verschuiven en uitsluitend met bewijs uit jouw data.",
    tone: "warning",
  },
  learned: {
    title: "Geleerd",
    label: "Patroon",
    blurb:
      "Patronen uit jouw eigen trainingsdata. Ze blijven voorstelbaar tot er voldoende bewijs is.",
    tone: "teal",
  },
} as const;

const PARAM_LABEL: Record<string, string> = {
  pain_threshold: "Pijngrens",
  max_increase_pct: "Maximale weekgroei",
  low: "Ondergrens",
  high: "Bovengrens",
  min_hours: "Minimale hersteltijd",
  inactive_days: "Inactiviteitsgrens",
  min_readiness: "Readiness-drempel",
  threshold_h: "Slaapdrempel",
  base_runs_last_21d: "Benodigde basis",
  min_quality_per_week: "Kwaliteitssessies",
  min_long_per_week: "Lange duurlopen",
};

function numberLabel(value: number) {
  return new Intl.NumberFormat("nl-BE", { maximumFractionDigits: 2 }).format(value);
}

function paramLabel(key: string) {
  return PARAM_LABEL[key] ?? key.replaceAll("_", " ");
}

function paramValue(key: string, value: unknown) {
  const formatted = typeof value === "number" ? numberLabel(value) : String(value);
  if (key === "pain_threshold") return `${formatted}/10`;
  if (key === "max_increase_pct") return `+${formatted}%`;
  if (key === "min_hours") return `${formatted} uur`;
  if (key === "inactive_days") return `${formatted} dagen`;
  if (key === "threshold_h") return `${formatted} uur`;
  if (key === "base_runs_last_21d") return `${formatted} runs in 21 dagen`;
  if (key === "min_quality_per_week" || key === "min_long_per_week") {
    return `${formatted} per week`;
  }
  return formatted;
}

function paramSummary(params: Record<string, unknown> | null | undefined) {
  const values = params ?? {};
  if (values.low != null && values.high != null) {
    return `Veilige band ${paramValue("low", values.low)}–${paramValue("high", values.high)}`;
  }
  const entries = Object.entries(values).slice(0, 2);
  if (entries.length === 0) return undefined;
  return entries
    .map(([key, value]) => `${paramLabel(key)} ${paramValue(key, value)}`)
    .join(" · ");
}

const TRIGGER_LABEL: Record<string, string> = {
  goal_created: "Doel aangemaakt",
  goal_changed: "Doel gewijzigd",
  run_completed: "Run afgerond",
  session_skipped: "Sessie geskipt",
  weekly_review: "Wekelijkse review",
  alarm: "Alarmsignaal",
  manual: "Handmatig",
};

export default async function CoachPage() {
  const [messages, rules, runs] = await Promise.all([
    getCoachMessages(),
    getRules(),
    getCoachRuns(10),
  ]);

  const monthStart = new Date();
  monthStart.setDate(1);
  const monthIso = monthStart.toISOString().slice(0, 10);
  const monthRuns = runs.filter((r) => r.created_at >= monthIso);
  const monthChat = messages.filter(
    (message) => message.role === "assistant" && message.created_at >= monthIso,
  );
  const monthCost =
    monthRuns.reduce((n, r) => n + Number(r.cost_usd ?? 0), 0) +
    monthChat.reduce((n, message) => n + Number(message.metadata?.cost_usd ?? 0), 0);

  return (
    <main className="space-y-5">
      <AppTopBar title="Coach" />
      <ScreenHeader
        eyebrow="Persoonlijke begeleiding"
        title="Vraag je coach"
        description="Vraag iets over je schema of vertel hoe je je voelt. De coach antwoordt met je actuele Garmin- en plangegevens."
        action={<Badge variant="recovery" className="mt-1">Garmin-context</Badge>}
      />

      <Tabs defaultValue="gesprek">
        <TabsList aria-label="Coachweergave">
          <TabsTrigger value="gesprek"><Bot /> Gesprek</TabsTrigger>
          <TabsTrigger value="regels"><ShieldCheck /> Regels</TabsTrigger>
        </TabsList>
        <TabsContent value="gesprek">
          <CoachChat initialMessages={messages} />
        </TabsContent>
        <TabsContent value="regels" className="space-y-6">

          {/* Kosten: transparant, want het draait op jouw credits. */}
          <Card className="p-4">
        <div className="flex items-baseline justify-between">
          <span className="label">Coachkosten deze maand</span>
          <span className="text-[11px] font-medium text-faint">
            {monthRuns.length + monthChat.length} aanroepen incl. chat
          </span>
        </div>
        <div className="numeral mt-2 text-[28px] font-bold">
          ${monthCost.toFixed(2)}
        </div>
        {runs[0] && (
          <div className="mt-3 border-t border-line pt-3">
            <div className="label mb-2">Laatste planningrun</div>
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] font-medium">
                {TRIGGER_LABEL[runs[0].trigger] ?? runs[0].trigger}
              </span>
              <span className="numeral text-[11px] text-faint">
                {runs[0].retries === 0 ? "geen herkansing" : `${runs[0].retries}× herkanst`}
              </span>
            </div>
            <div className="numeral mt-1 text-[11px] text-faint">
              {runs[0].model} · ${Number(runs[0].cost_usd ?? 0).toFixed(2)} ·{" "}
              {Math.round((runs[0].duration_ms ?? 0) / 1000)} s
            </div>
          </div>
        )}
          </Card>

          {(["core", "tunable", "learned"] as const).map((cls) => {
        const list = rules.filter((r) => r.class === cls);
        const meta = CLASSES[cls];
        return (
          <section key={cls}>
            <div className="mb-3">
              <div className="flex items-center gap-2">
                <h2 className="text-[16px] font-semibold tracking-[-0.02em]">
                  {meta.title}
                </h2>
                <span className="numeral inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-line bg-s2 px-1.5 text-[10px] text-muted">
                  {list.length}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-[1.5] text-muted">{meta.blurb}</p>
            </div>

            {list.length === 0 ? (
              <div className="row p-3 text-xs text-faint">
                Nog geen regels in deze categorie.
              </div>
            ) : (
              <div className="space-y-1.5">
                {list.map((r) => {
                  const summary = [
                    r.user_pinned ? "Door jou vastgezet" : null,
                    paramSummary(r.params),
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                  <CoachRuleRow
                    key={r.key}
                    eyebrow={r.status === "proposed" ? "Voorgesteld" : meta.label}
                    title={r.title.nl}
                    summary={summary || undefined}
                    tone={meta.tone}
                    drawerTitle={r.title.nl}
                    drawerSubtitle={`${meta.title} · ${r.status === "proposed" ? "voorgesteld" : "actief"}`}
                  >
                    <p className="text-[13px] leading-relaxed text-muted">
                      {r.rationale.nl}
                    </p>
                    {Object.keys(r.params ?? {}).length > 0 && (
                      <div className="mt-4">
                        <div className="label mb-2">Huidige waarden</div>
                        <div className="space-y-1">
                          {Object.entries(r.params).map(([k, v]) => (
                            <div
                              key={k}
                              className="row flex items-center justify-between px-3 py-2"
                            >
                              <span className="text-[11px] capitalize text-muted">
                                {paramLabel(k)}
                              </span>
                              <span className="numeral text-[13px] font-semibold">
                                {paramValue(k, v)}
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
            )}
          </section>
        );
          })}
        </TabsContent>
      </Tabs>
    </main>
  );
}
