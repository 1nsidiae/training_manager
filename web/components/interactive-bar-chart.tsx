"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";

export type InteractiveBarDatum = {
  id: string;
  eyebrow: string;
  dateLabel: string;
  valueLabel: string;
  value: number | null;
  color: string;
  axisLabel?: string;
  muted?: boolean;
};

type Reference = {
  value: number;
  label: string;
  color: string;
};

/** Recharts-kolomgrafiek voor discrete periodes zoals weken en nachten.
 * Hover/touch toont de exacte meting; tikken bewaart de selectie. */
export function InteractiveBarChart({
  data,
  ariaLabel,
  className,
  average,
  threshold,
}: {
  data: InteractiveBarDatum[];
  ariaLabel: string;
  className?: string;
  average?: Reference;
  threshold?: Reference;
}) {
  const measured = useMemo(() => data.filter((item) => item.value != null), [data]);
  const [selectedId, setSelectedId] = useState(measured.at(-1)?.id ?? null);
  const selected = data.find((item) => item.id === selectedId) ?? measured.at(-1) ?? null;
  const max = Math.max(
    ...measured.map((item) => item.value as number),
    average?.value ?? 0,
    threshold?.value ?? 0,
    1,
  );

  return (
    <div className={cn("w-full", className)} aria-label={ariaLabel}>
      <div className="mb-3 flex min-h-10 items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="micro">Geselecteerde periode</div>
          <div className="mt-1 truncate text-[11px] font-semibold text-muted">
            {selected?.dateLabel ?? "Tik op een kolom"}
          </div>
        </div>
        <div className="numeral shrink-0 text-[22px] font-semibold" style={{ color: selected?.color }}>
          {selected?.valueLabel ?? "–"}
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
              const item = Number.isInteger(index) ? data[index] : undefined;
              if (item?.value != null) setSelectedId(item.id);
            }}
          >
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.07)" strokeDasharray="2 5" />
            <XAxis
              dataKey="id"
              axisLine={false}
              tickLine={false}
              tickFormatter={(_, index) => data[index]?.axisLabel ?? ""}
              tick={{ fill: "#7f898d", fontSize: 9, fontWeight: 600 }}
              interval={data.length > 10 ? 1 : 0}
              minTickGap={4}
            />
            <YAxis hide domain={[0, max * 1.16]} />
            {average ? (
              <ReferenceLine y={average.value} stroke={average.color} strokeDasharray="4 5" strokeOpacity={0.7} />
            ) : null}
            {threshold ? (
              <ReferenceLine y={threshold.value} stroke={threshold.color} strokeDasharray="2 4" strokeOpacity={0.75} />
            ) : null}
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.035)" }}
              content={({ active, payload }) => {
                const item = payload?.[0]?.payload as InteractiveBarDatum | undefined;
                if (!active || !item || item.value == null) return null;
                return (
                  <div className="rounded-row border border-line-strong bg-s2 px-3 py-2 shadow-xl">
                    <div className="text-[8px] font-bold uppercase tracking-[0.1em] text-faint">{item.eyebrow}</div>
                    <div className="mt-1 text-[11px] font-semibold text-muted">{item.dateLabel}</div>
                    <div className="numeral mt-1.5 text-[17px]" style={{ color: item.color }}>{item.valueLabel}</div>
                    <div className="mt-1 text-[9px] text-faint">Tik om vast te zetten</div>
                  </div>
                );
              }}
            />
            <Bar
              dataKey="value"
              radius={[9, 9, 3, 3]}
              maxBarSize={48}
              minPointSize={2}
              isAnimationActive
              animationDuration={550}
            >
              {data.map((item) => (
                <Cell
                  key={item.id}
                  fill={item.color}
                  fillOpacity={item.muted ? 0.35 : selectedId && selectedId !== item.id ? 0.64 : 1}
                  stroke={selectedId === item.id ? "rgba(255,255,255,0.88)" : "transparent"}
                  strokeWidth={selectedId === item.id ? 1.5 : 0}
                />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {average || threshold ? (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-line pt-3">
          {average ? (
            <div className="flex items-center gap-1.5 text-[9px] font-semibold text-faint">
              <span className="h-px w-4 border-t border-dashed" style={{ borderColor: average.color }} />
              {average.label}
            </div>
          ) : null}
          {threshold ? (
            <div className="flex items-center gap-1.5 text-[9px] font-semibold text-faint">
              <span className="h-px w-4 border-t border-dashed" style={{ borderColor: threshold.color }} />
              {threshold.label}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
