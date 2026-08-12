import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Chevron } from "./ui";
import { Sparkline } from "./sparkline";

type Props = {
  name: string;
  value: string;
  unit?: string;
  baseline?: string;
  tone?: string;
  icon: React.ReactNode;
  series?: (number | null)[];
  color?: string;
  href?: string;
};

/** Dashboard Metric Card per designdocument: waarde linksboven, vergelijking
 *  eronder, chevron rechtsboven, icoon met naam onderaan. Bedoeld voor een
 *  raster van twee kolommen. */
export function MetricCard({
  name,
  value,
  unit,
  baseline,
  tone = "text-ink",
  icon,
  series,
  color = "#67aee6",
  href,
}: Props) {
  const body = (
    <Card className="surface-pressable flex h-full min-h-[146px] flex-col p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-baseline gap-1">
            <span className={`numeral text-[2rem] font-bold ${tone}`}>{value}</span>
            {unit && <span className="text-xs text-faint">{unit}</span>}
          </div>
          {baseline && <div className="micro mt-1">{baseline}</div>}
        </div>
        {href && <Chevron />}
      </div>

      {series && series.length > 1 && (
        <div className="-mx-3.5 mt-2">
          <Sparkline values={series} color={color} height={26} />
        </div>
      )}

      <div className="mt-auto flex items-center gap-1.5 pt-3 text-faint">
        {icon}
        <span className="text-xs font-medium">{name}</span>
      </div>
    </Card>
  );

  return href ? (
    <Link href={href} className="focus-ring block rounded-card">
      {body}
    </Link>
  ) : (
    body
  );
}

/* Thin monoline iconen, 1.75 stroke, ronde uiteinden, monochroom. */
const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const Icons = {
  heart: (
    <svg viewBox="0 0 24 24" className="size-3.5" {...base}>
      <path d="M12 20s-7-4.5-7-9.5A3.5 3.5 0 0 1 12 8a3.5 3.5 0 0 1 7 2.5c0 5-7 9.5-7 9.5Z" />
    </svg>
  ),
  moon: (
    <svg viewBox="0 0 24 24" className="size-3.5" {...base}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
    </svg>
  ),
  activity: (
    <svg viewBox="0 0 24 24" className="size-3.5" {...base}>
      <path d="M3 12h3.5L9 5l4 14 2.5-7H21" />
    </svg>
  ),
  lungs: (
    <svg viewBox="0 0 24 24" className="size-3.5" {...base}>
      <path d="M12 4v9M12 13c0-3-2-4-3.5-4S5 10.5 5 14v4h4v-5M12 13c0-3 2-4 3.5-4S19 10.5 19 14v4h-4v-5" />
    </svg>
  ),
  route: (
    <svg viewBox="0 0 24 24" className="size-3.5" {...base}>
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <path d="M8.5 18H14a3.5 3.5 0 0 0 0-7h-4a3.5 3.5 0 0 1 0-7h5.5" />
    </svg>
  ),
};
