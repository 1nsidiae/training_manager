"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type StepBucket = {
  start_gmt: string;
  end_gmt: string;
  steps: number;
};

type StepPoint = {
  slot: number;
  interval: string;
  steps: number;
};

type Props = {
  buckets: StepBucket[];
  color: string;
};

function asUtc(value: string) {
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`;
}

function timeLabel(slot: number) {
  if (slot >= 96) return "24:00";
  const hour = Math.floor(slot / 4);
  const minute = (slot % 4) * 15;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function InteractiveStepsChart({ buckets, color }: Props) {
  const data = useMemo<StepPoint[]>(() => {
    const totals = Array.from({ length: 96 }, () => 0);
    for (const bucket of buckets) {
      const date = new Date(asUtc(bucket.start_gmt));
      if (!Number.isNaN(date.getTime())) {
        const slot = date.getHours() * 4 + Math.floor(date.getMinutes() / 15);
        totals[slot] += bucket.steps;
      }
    }
    return totals.map((steps, slot) => ({
      slot,
      interval: `${timeLabel(slot)}–${timeLabel(slot + 1)}`,
      steps,
    }));
  }, [buckets]);

  const latestActive = useMemo(() => [...data].reverse().find((point) => point.steps > 0) ?? data[0], [data]);
  const [selected, setSelected] = useState<StepPoint>(latestActive);
  useEffect(() => setSelected(latestActive), [latestActive]);

  if (!buckets.length) {
    return (
      <div className="grid h-[220px] place-items-center px-5 text-center">
        <div>
          <div className="text-[12px] font-semibold text-muted">Nog geen dagverloop gesynchroniseerd</div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-faint">
            Synchroniseer Garmin opnieuw om de stappenblokken van deze dag op te halen.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex min-h-10 items-end justify-between gap-3">
        <div>
          <div className="micro">Geselecteerd kwartier</div>
          <div className="mt-1 text-[11px] font-semibold text-muted">{selected.interval}</div>
        </div>
        <div className="numeral text-[24px] font-semibold" style={{ color }}>
          {selected.steps.toLocaleString("nl-BE")} <span className="text-[10px] text-faint">stappen</span>
        </div>
      </div>

      <div className="h-[174px] w-full" style={{ touchAction: "pan-y" }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 2, bottom: 0, left: 2 }}
            accessibilityLayer
            onClick={(state) => {
              const index = Number(state?.activeTooltipIndex);
              if (Number.isInteger(index) && data[index]) setSelected(data[index]);
            }}
          >
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.07)" strokeDasharray="2 5" />
            <XAxis
              dataKey="slot"
              ticks={[0, 24, 48, 72, 95]}
              tickFormatter={(slot) => Number(slot) === 95 ? "24:00" : timeLabel(Number(slot))}
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#7f898d", fontSize: 9, fontWeight: 600 }}
            />
            <YAxis hide domain={[0, "dataMax"]} />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.035)" }}
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as StepPoint | undefined;
                if (!active || !point) return null;
                return (
                  <div className="rounded-row border border-line-strong bg-s2 px-3 py-2 shadow-xl">
                    <div className="micro">{point.interval}</div>
                    <div className="numeral mt-1 text-[17px]" style={{ color }}>
                      {point.steps.toLocaleString("nl-BE")} stappen
                    </div>
                    <div className="mt-1 text-[9px] text-faint">Tik om vast te zetten</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="steps" radius={[4, 4, 1, 1]} isAnimationActive animationDuration={500}>
              {data.map((point) => (
                <Cell
                  key={point.slot}
                  fill={point.slot === selected.slot ? color : `${color}8f`}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
