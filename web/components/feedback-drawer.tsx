"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerNested,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Activity, PlanSession, SessionFeedback } from "@/lib/queries";

const FEELINGS = [
  { label: "Zwaar", value: 2, code: "heavy" },
  { label: "Matig", value: 4, code: "flat" },
  { label: "Normaal", value: 6, code: "normal" },
  { label: "Goed", value: 8, code: "good" },
  { label: "Sterk", value: 10, code: "strong" },
] as const;

export function FeedbackDrawer({
  activity,
  session,
  feedback,
  nested = false,
  children,
}: {
  activity: Activity;
  session: PlanSession | null;
  feedback: SessionFeedback | null;
  nested?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pain, setPain] = React.useState(feedback?.pain_score ?? 0);
  const [rpe, setRpe] = React.useState(feedback?.extra?.rpe ?? 5);
  const [endurance, setEndurance] = React.useState(feedback?.endurance_score ?? 6);
  const [notes, setNotes] = React.useState(feedback?.notes ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function saveFeedback() {
    setSaving(true);
    setError(null);
    const sb = createClient();
    const feeling = FEELINGS.find((option) => option.value === endurance)?.code ?? "normal";
    const planSessionId = feedback?.plan_session_id ?? session?.id ?? null;
    const payload = {
      plan_session_id: planSessionId,
      activity_id: activity.id,
      pain_score: pain,
      endurance_score: endurance,
      extra: { ...(feedback?.extra ?? {}), rpe, feeling, source: "pwa" },
      notes: notes.trim() || null,
    };

    const feedbackResult = feedback?.id
      ? await sb.from("session_feedback").update(payload).eq("id", feedback.id)
      : await sb.from("session_feedback").insert(payload);

    if (feedbackResult.error) {
      setError("Opslaan lukte niet. Controleer je verbinding en probeer opnieuw.");
      setSaving(false);
      return;
    }

    if (planSessionId != null) {
      const { error: sessionError } = await sb
        .from("plan_sessions")
        .update({ status: "completed", activity_id: activity.id })
        .eq("id", planSessionId);
      if (sessionError) {
        setError("Feedback is opgeslagen, maar de geplande training kon niet worden gekoppeld.");
        setSaving(false);
        router.refresh();
        return;
      }
    }

    setSaving(false);
    setOpen(false);
    router.refresh();
  }

  const Root = nested ? DrawerNested : Drawer;

  return (
    <Root open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>{children}</DrawerTrigger>
      <DrawerContent>
        <div className="border-b border-line px-4 pb-3 pt-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DrawerTitle className="text-[17px] font-semibold tracking-[-0.02em]">
                Hoe voelde deze training?
              </DrawerTitle>
              <DrawerDescription className="mt-1 text-[11px] text-faint">
                Vier korte signalen voor je volgende trainingsaanpassing.
              </DrawerDescription>
            </div>
            {feedback ? <Badge variant="teal">ingevuld</Badge> : null}
          </div>
        </div>

        <div className="overflow-y-auto px-4 pb-6 pt-4">
          {session ? (
            <div className="mb-4 rounded-xl border border-line bg-s2 px-3 py-2.5">
              <div className="text-[8px] font-bold uppercase tracking-[0.1em] text-faint">
                Gekoppelde training
              </div>
              <div className="mt-1 truncate text-[12px] font-semibold text-ink">
                {session.title}
              </div>
            </div>
          ) : (
            <div className="mb-4 rounded-xl border border-line bg-s2 px-3 py-2.5 text-[11px] leading-relaxed text-muted">
              Geen geplande training op deze datum. Je feedback wordt wel bewaard en meegenomen door de coach.
            </div>
          )}

          <ScoreSlider
            label="Pijn of blessuregevoel"
            value={pain}
            onChange={setPain}
            min={0}
            low="Geen pijn"
            high="Ernstig"
            tone={pain >= 6 ? "text-danger" : pain >= 3 ? "text-warning" : "text-teal"}
          />

          <ScoreSlider
            label="Ervaren inspanning"
            value={rpe}
            onChange={setRpe}
            min={1}
            low="Zeer licht"
            high="Maximaal"
          />

          <div className="mt-5">
            <div className="mb-2.5 flex items-baseline justify-between gap-3">
              <label className="text-[12px] font-semibold text-ink">Conditiegevoel</label>
              <span className="text-[10px] text-faint">hoe liep je motor?</span>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {FEELINGS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setEndurance(option.value)}
                  className={cn(
                    "focus-ring min-h-12 rounded-xl border px-1 text-[9px] font-semibold transition-colors",
                    endurance === option.value
                      ? "border-teal/40 bg-teal/10 text-teal"
                      : "border-line bg-s2 text-faint hover:border-line-strong hover:text-ink",
                  )}
                  aria-pressed={endurance === option.value}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <label htmlFor={`feedback-note-${activity.id}`} className="mb-2 block text-[12px] font-semibold text-ink">
              Notitie <span className="font-normal text-faint">optioneel</span>
            </label>
            <Textarea
              id={`feedback-note-${activity.id}`}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={500}
              placeholder="Bijvoorbeeld: linkerkuit voelde stijf na 20 minuten…"
            />
          </div>

          {error ? (
            <p className="mt-3 text-[11px] leading-relaxed text-danger" role="alert">
              {error}
            </p>
          ) : null}

          <Button className="mt-5 w-full" onClick={saveFeedback} disabled={saving}>
            {saving ? <LoaderCircle className="animate-spin" /> : <Check />}
            {saving ? "Opslaan" : feedback ? "Feedback bijwerken" : "Feedback opslaan"}
          </Button>
        </div>
      </DrawerContent>
    </Root>
  );
}

function ScoreSlider({
  label,
  value,
  onChange,
  min,
  low,
  high,
  tone = "text-ink",
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  low: string;
  high: string;
  tone?: string;
}) {
  return (
    <div className="mt-5 first:mt-0">
      <div className="flex items-center justify-between gap-3">
        <label className="text-[12px] font-semibold text-ink">{label}</label>
        <span className={cn("numeral text-[24px] font-bold", tone)}>{value}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={10}
        step={1}
        onValueChange={(values) => onChange(values[0])}
        aria-label={label}
      />
      <div className="flex justify-between text-[9px] font-medium text-faint">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}
