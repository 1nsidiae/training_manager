import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

export type MetricDeltaDirection = "up" | "down" | "flat";
export type MetricDeltaTone = "positive" | "negative" | "warning" | "info" | "recovery" | "neutral";

const TONE_CLASS: Record<MetricDeltaTone, string> = {
  positive: "text-teal",
  negative: "text-danger",
  warning: "text-warning",
  info: "text-strain",
  recovery: "text-recovery",
  neutral: "text-faint",
};

const DIRECTION_ICON = {
  up: ArrowUp,
  down: ArrowDown,
  flat: ArrowRight,
} satisfies Record<MetricDeltaDirection, typeof ArrowUp>;

/**
 * Een verandering of periodevergelijking. Dit is bewust géén Badge: kleur is
 * hier data en krijgt daarom geen capsule, rand of gekleurde achtergrond.
 */
function MetricDelta({
  direction,
  tone,
  className,
  children,
  ...props
}: React.ComponentProps<"span"> & {
  direction: MetricDeltaDirection;
  tone: MetricDeltaTone;
}) {
  const Icon = DIRECTION_ICON[direction];

  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1 whitespace-nowrap text-[10px] font-bold tabular-nums",
        TONE_CLASS[tone],
        className,
      )}
      {...props}
    >
      <Icon className="size-[1.15em] shrink-0 stroke-[2.25]" aria-hidden="true" />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

export { MetricDelta };
