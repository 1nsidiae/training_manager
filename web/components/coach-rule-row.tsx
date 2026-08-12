import { DetailDrawer } from "@/components/detail-drawer";
import { Chevron } from "@/components/ui";
import { Card } from "@/components/ui/card";

type Tone = "danger" | "warning" | "recovery" | "teal";

const TONES: Record<Tone, { eyebrow: string }> = {
  danger: {
    eyebrow: "text-danger",
  },
  warning: {
    eyebrow: "text-warning",
  },
  recovery: {
    eyebrow: "text-recovery",
  },
  teal: {
    eyebrow: "text-teal",
  },
};

/** Rustige, redactionele rij voor coachregels en planonderbouwing. Kleur blijft
 *  beperkt tot het kleine statuslabel; bewijs en waarden zitten in de drawer. */
export function CoachRuleRow({
  eyebrow,
  title,
  summary,
  tone,
  drawerTitle,
  drawerSubtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  summary?: string;
  tone: Tone;
  drawerTitle: string;
  drawerSubtitle?: string;
  children: React.ReactNode;
}) {
  const style = TONES[tone];

  return (
    <DetailDrawer
      title={drawerTitle}
      subtitle={drawerSubtitle}
      triggerClassName="focus-ring block w-full rounded-card text-left"
      trigger={
        <Card className="surface-pressable">
          <div className="flex min-h-[70px] items-center gap-3 px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <div
                className={`text-[9px] font-bold uppercase tracking-[0.09em] ${style.eyebrow}`}
              >
                {eyebrow}
              </div>
              <div
                className={`${summary ? "line-clamp-1" : "line-clamp-2"} mt-1 text-[13px] font-semibold leading-[1.35] text-ink`}
              >
                {title}
              </div>
              {summary ? (
                <div className="mt-1 line-clamp-1 text-[10px] font-medium text-faint">
                  {summary}
                </div>
              ) : null}
            </div>
            <Chevron />
          </div>
        </Card>
      }
    >
      {children}
    </DetailDrawer>
  );
}
