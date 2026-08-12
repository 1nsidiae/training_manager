type Props = {
  value: number | null;
  max?: number;
  color: string;
  size?: number;
  stroke?: number;
  animate?: boolean;
  children?: React.ReactNode;
};

/** Metric Ring per designdocument: donkere track, gekleurde boog, grote waarde
 *  in het midden. Stroke 4-6pt, geen gradient, geen gloed. Tekent met de klok
 *  mee bij de eerste weergave.
 *
 *  Ontbrekende data toont een lege track, geen nul — "niet gemeten" en "slecht"
 *  mogen niet op elkaar lijken. */
export function Ring({
  value,
  max = 100,
  color,
  size = 84,
  stroke = 6,
  animate = false,
  children,
}: Props) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(1, value / max));

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-s3)"
          strokeWidth={stroke}
        />
        {value != null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - pct)}
            className={animate ? "ring-draw" : undefined}
            style={{ "--dash-full": circumference } as React.CSSProperties}
          />
        )}
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}
