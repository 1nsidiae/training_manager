type Props = {
  values: (number | null)[];
  color: string;
  height?: number;
  fill?: boolean;
};

/** Context bij een getal: waar kwam het vandaan. Een losse waarde zonder trend
 *  dwingt de lezer om te onthouden wat er gisteren stond. */
export function Sparkline({ values, color, height = 28, fill = true }: Props) {
  const points = values.filter((v): v is number => v != null);
  if (points.length < 2) {
    return <div style={{ height }} className="w-full" />;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const w = 100;

  // Ontbrekende dagen overslaan in plaats van als nul tekenen: een niet gemeten
  // nacht is geen slechte nacht.
  const coords: [number, number][] = [];
  values.forEach((v, i) => {
    if (v == null) return;
    const x = (i / (values.length - 1)) * w;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    coords.push([x, y]);
  });

  const line = coords
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${coords.at(-1)![0].toFixed(1)},${height} L${coords[0][0].toFixed(1)},${height} Z`;
  const id = `sp-${color.replace("#", "")}`;

  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${id})`} />
        </>
      )}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={coords.at(-1)![0]}
        cy={coords.at(-1)![1]}
        r="2.5"
        fill={color}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
