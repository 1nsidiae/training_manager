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

export type DayPoint = {
  timestamp_ms: number;
  value: number;
};

type Props = {
  data: DayPoint[];
  color: string;
  formatValue: (value: number | null) => string;
  reference?: number | null;
  emptyLabel?: string;
};

function timeLabel(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("nl-BE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function InteractiveDayChart({ data, color, formatValue, reference, emptyLabel }: Props) {
  const measured = useMemo(
    () => data.filter((point) => Number.isFinite(point.timestamp_ms) && Number.isFinite(point.value)),
    [data],
  );
  const latest = measured.at(-1) ?? null;
  const [selected, setSelected] = useState<DayPoint | null>(latest);
  useEffect(() => setSelected(latest), [latest]);

  const domain = useMemo(() => {
    const values = measured.map((point) => point.value);
    if (reference != null) values.push(reference);
    if (!values.length) return [0, 100] as [number, number];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max((max - min) * 0.16, max * 0.04, 1);
    return [Math.max(0, min - padding), max + padding] as [number, number];
  }, [measured, reference]);

  if (!measured.length) {
    return (
      <div className="grid h-[220px] place-items-center px-5 text-center">
        <div>
          <div className="text-[12px] font-semibold text-muted">{emptyLabel ?? "Nog geen dagverloop gesynchroniseerd"}</div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-faint">
            Synchroniseer Garmin opnieuw om de metingen van deze dag op te halen.
          </p>
        </div>
      </div>
    );
  }

  const first = measured[0].timestamp_ms;
  const last = measured.at(-1)!.timestamp_ms;
  const middle = first + (last - first) / 2;

  return (
    <div>
      <div className="mb-3 flex min-h-10 items-end justify-between gap-3">
        <div>
          <div className="micro">Geselecteerde meting</div>
          <div className="mt-1 text-[11px] font-semibold text-muted">
            {selected ? timeLabel(selected.timestamp_ms) : "Tik op de grafiek"}
          </div>
        </div>
        <div className="numeral text-[24px] font-semibold" style={{ color }}>
          {formatValue(selected?.value ?? null)}
        </div>
      </div>

      <div className="h-[174px] w-full" style={{ touchAction: "pan-y" }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={measured}
            margin={{ top: 8, right: 3, bottom: 0, left: 3 }}
            accessibilityLayer
            onClick={(state) => {
              const index = Number(state?.activeTooltipIndex);
              if (Number.isInteger(index) && measured[index]) setSelected(measured[index]);
            }}
          >
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.07)" strokeDasharray="2 5" />
            <XAxis
              type="number"
              dataKey="timestamp_ms"
              domain={[first, last]}
              ticks={[first, middle, last]}
              tickFormatter={(timestamp) => timeLabel(Number(timestamp))}
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#7f898d", fontSize: 9, fontWeight: 600 }}
            />
            <YAxis hide domain={domain} />
            {reference != null ? (
              <ReferenceLine y={reference} stroke="rgba(255,255,255,0.32)" strokeDasharray="4 5" />
            ) : null}
            <Tooltip
              cursor={{ stroke: "rgba(255,255,255,0.35)", strokeWidth: 1 }}
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as DayPoint | undefined;
                if (!active || !point) return null;
                return (
                  <div className="rounded-row border border-line-strong bg-s2 px-3 py-2 shadow-xl">
                    <div className="micro">{timeLabel(point.timestamp_ms)}</div>
                    <div className="numeral mt-1 text-[17px]" style={{ color }}>
                      {formatValue(point.value)}
                    </div>
                    <div className="mt-1 text-[9px] text-faint">Tik om vast te zetten</div>
                  </div>
                );
              }}
            />
            <Area type="monotone" dataKey="value" stroke="none" fill={color} fillOpacity={0.11} />
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, fill: color, stroke: "#ffffff", strokeWidth: 2 }}
              isAnimationActive
              animationDuration={500}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
