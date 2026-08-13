"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type TrendPoint = {
  day: string;
  value: number | null;
};

type Props = {
  data: TrendPoint[];
  color: string;
  average?: number | null;
  formatValue: (value: number | null) => string;
};

function dayLabel(day: string, long = false) {
  return new Date(`${day}T12:00:00`).toLocaleDateString("nl-BE", long
    ? { weekday: "short", day: "numeric", month: "short" }
    : { day: "numeric", month: "short" });
}

/** Recharts-lijn met hover/touch-tooltip én een selectie die na het tikken
 * zichtbaar blijft. Ontbrekende Garmin-dagen blijven echte gaten in de lijn. */
export function InteractiveTrendChart({ data, color, average, formatValue }: Props) {
  const measured = useMemo(() => data.filter((point) => point.value != null), [data]);
  const [selected, setSelected] = useState<TrendPoint | null>(measured.at(-1) ?? null);
  useEffect(() => {
    setSelected(measured.at(-1) ?? null);
  }, [measured]);
  const domain = useMemo(() => {
    const values = measured.map((point) => point.value as number);
    if (!values.length) return [0, 100] as [number, number];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max((max - min) * 0.18, max * 0.04, 1);
    return [Math.max(0, min - padding), max + padding] as [number, number];
  }, [measured]);
  const tickDays = data.length > 2
    ? [data[0].day, data[Math.floor((data.length - 1) / 2)].day, data.at(-1)!.day]
    : data.map((point) => point.day);

  if (!measured.length) {
    return <div className="grid h-40 place-items-center text-xs text-faint">Geen metingen in deze periode</div>;
  }

  return (
    <div>
      <div className="mb-3 flex min-h-10 items-end justify-between gap-3">
        <div>
          <div className="micro">Geselecteerde meting</div>
          <div className="mt-1 text-[11px] font-semibold text-muted">
            {selected ? dayLabel(selected.day, true) : "Tik op de grafiek"}
          </div>
        </div>
        <div className="numeral text-[24px] font-semibold" style={{ color }}>
          {formatValue(selected?.value ?? null)}
        </div>
      </div>

      <div className="h-[174px] w-full" style={{ touchAction: "pan-y" }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 10, right: 4, bottom: 0, left: 4 }}
            accessibilityLayer
            onClick={(state) => {
              const index = Number(state?.activeTooltipIndex);
              const point = Number.isInteger(index) ? data[index] : undefined;
              if (point?.value != null) setSelected(point);
            }}
          >
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.07)" strokeDasharray="2 5" />
            <XAxis
              dataKey="day"
              ticks={tickDays}
              tickFormatter={(day) => dayLabel(String(day))}
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#7f898d", fontSize: 9, fontWeight: 600 }}
              minTickGap={18}
            />
            <YAxis hide domain={domain} />
            {average != null ? (
              <ReferenceLine
                y={average}
                stroke="rgba(255,255,255,0.28)"
                strokeDasharray="4 5"
              />
            ) : null}
            <Tooltip
              cursor={{ stroke: "rgba(255,255,255,0.35)", strokeWidth: 1 }}
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as TrendPoint | undefined;
                if (!active || !point || point.value == null) return null;
                return (
                  <div className="rounded-row border border-line-strong bg-s2 px-3 py-2 shadow-xl">
                    <div className="micro">{dayLabel(point.day, true)}</div>
                    <div className="numeral mt-1 text-[17px]" style={{ color }}>
                      {formatValue(point.value)}
                    </div>
                    <div className="mt-1 text-[9px] text-faint">Tik om vast te zetten</div>
                  </div>
                );
              }}
            />
            <Area
              type="linear"
              dataKey="value"
              stroke="none"
              fill={color}
              fillOpacity={0.11}
              connectNulls={false}
              isAnimationActive
              animationDuration={550}
            />
            <Line
              type="linear"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              dot={measured.length === 1 ? { r: 5, fill: color, stroke: "#ffffff", strokeWidth: 2 } : false}
              activeDot={{ r: 5, fill: color, stroke: "#ffffff", strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive
              animationDuration={550}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
