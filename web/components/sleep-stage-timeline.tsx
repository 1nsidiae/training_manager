"use client";

import { useMemo, useState } from "react";
import { Clock3 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hours } from "@/lib/format";
import type { Wellness } from "@/lib/queries";

type SleepLevel = NonNullable<NonNullable<Wellness["raw"]>["sleep_detail"]>["levels"][number];

const PHASES = {
  0: { label: "Diep", color: "#237fd3", height: 25 },
  1: { label: "Licht", color: "#55aaf5", height: 50 },
  2: { label: "REM", color: "#d12bbd", height: 75 },
  3: { label: "Wakker", color: "#e66dcc", height: 100 },
} as const;

function gmt(value: string) {
  /* Garmin gebruikt hier vaak `YYYY-MM-DD HH:mm:ss`. Chromium accepteert die
     losse spatie, maar iOS/Safari eist een echte ISO-`T`; anders verdwijnen
     alle segmenten uit de tijdlijn als "ongeldige" datums. */
  const iso = value.trim().replace(" ", "T").replace(/\.\d+$/, "");
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/i.test(iso) ? iso : `${iso}Z`;
  return Date.parse(zoned);
}

function timeLabel(timestamp: number) {
  return new Intl.DateTimeFormat("nl-BE", {
    timeZone: "Europe/Brussels",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function durationLabel(start: number, end: number) {
  const minutes = Math.max(1, Math.round((end - start) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}u ${String(minutes % 60).padStart(2, "0")}`;
}

function PhaseTotals({ wellness }: { wellness: Wellness }) {
  const phases = [
    { label: "Diepe slaap", value: wellness.sleep_deep_s, color: PHASES[0].color },
    { label: "Lichte slaap", value: wellness.sleep_light_s, color: PHASES[1].color },
    { label: "REM-slaap", value: wellness.sleep_rem_s, color: PHASES[2].color },
    { label: "Wakker", value: wellness.sleep_awake_s, color: PHASES[3].color },
  ];
  const asleep = phases.slice(0, 3).reduce((sum, phase) => sum + (phase.value ?? 0), 0);

  return (
    <div className="space-y-1">
      {phases.map((phase) => {
        const share = asleep && phase.label !== "Wakker" ? ((phase.value ?? 0) / asleep) * 100 : null;
        return (
          <div key={phase.label} className="flex min-h-12 items-center gap-3 border-b border-line py-2 last:border-0">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: phase.color }} />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-muted">{phase.label}</div>
              {share != null ? <div className="micro mt-0.5">{share.toFixed(0)}% van je slaaptijd</div> : null}
            </div>
            <div className="numeral text-[15px] font-semibold">{hours(phase.value)}</div>
          </div>
        );
      })}
    </div>
  );
}

export function SleepStageTimeline({ wellness }: { wellness: Wellness }) {
  const levels = wellness.raw?.sleep_detail?.levels ?? [];
  const normalized = useMemo(() => levels
    .map((level) => ({ ...level, start: gmt(level.start_gmt), end: gmt(level.end_gmt) }))
    .filter((level) => Number.isFinite(level.start) && Number.isFinite(level.end) && level.end > level.start), [levels]);
  const [selected, setSelected] = useState<(typeof normalized)[number] | null>(null);
  const [hovered, setHovered] = useState<(typeof normalized)[number] | null>(null);
  const active = hovered ?? selected;
  const start = normalized[0]?.start ?? 0;
  const end = normalized.at(-1)?.end ?? 0;
  const duration = end - start;

  return (
    <Tabs defaultValue={normalized.length ? "timeline" : "phases"}>
      <TabsList className="h-9">
        <TabsTrigger value="timeline">Tijdlijn</TabsTrigger>
        <TabsTrigger value="phases">Fasen</TabsTrigger>
      </TabsList>

      <TabsContent value="timeline" className="mt-5">
        {normalized.length ? (
          <>
        <div className="grid grid-cols-[44px_1fr] gap-2">
          <div className="relative h-[172px] text-[9px] font-semibold text-faint">
            {["Wakker", "REM", "Licht", "Diep"].map((label, index) => (
              <span
                key={label}
                className="absolute right-0 -translate-y-1/2"
                style={{ top: `${12.5 + index * 25}%` }}
              >
                {label}
              </span>
            ))}
          </div>

          <div className="relative h-[172px] overflow-hidden rounded-row bg-s1">
            {[25, 50, 75].map((position) => (
              <span
                key={position}
                className="pointer-events-none absolute inset-x-0 border-t border-line"
                style={{ bottom: `${position}%` }}
              />
            ))}
            {normalized.map((level, index) => {
              const phase = PHASES[level.level as keyof typeof PHASES];
              const left = duration ? ((level.start - start) / duration) * 100 : 0;
              const width = duration ? ((level.end - level.start) / duration) * 100 : 0;
              const isActive = active === level;
              return (
                <button
                  key={`${level.start_gmt}-${index}`}
                  type="button"
                  className="focus-ring absolute bottom-0 border-r border-canvas/40 transition-[filter,opacity] hover:brightness-125 focus-visible:z-10"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    height: `${phase.height}%`,
                    backgroundColor: phase.color,
                    opacity: active && !isActive ? 0.52 : 1,
                  }}
                  aria-label={`${phase.label}, ${timeLabel(level.start)} tot ${timeLabel(level.end)}, ${durationLabel(level.start, level.end)}`}
                  onClick={() => setSelected(level)}
                  onPointerEnter={() => setHovered(level)}
                  onPointerLeave={() => setHovered(null)}
                />
              );
            })}
          </div>
        </div>

        <div className="ml-[52px] mt-2 flex justify-between text-[10px] font-semibold text-faint">
          <span>{start ? timeLabel(start) : "–"}</span>
          <span>{end ? timeLabel(end) : "–"}</span>
        </div>

        <div className="mt-4 min-h-[58px] rounded-row bg-s2 px-3 py-2.5" aria-live="polite">
          {active ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="size-3 rounded-sm" style={{ backgroundColor: PHASES[active.level as keyof typeof PHASES].color }} />
                <div>
                  <div className="text-[12px] font-semibold">{PHASES[active.level as keyof typeof PHASES].label}</div>
                  <div className="micro mt-0.5">{timeLabel(active.start)}–{timeLabel(active.end)}</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted">
                <Clock3 className="size-3.5" />
                {durationLabel(active.start, active.end)}
              </div>
            </div>
          ) : (
            <div className="grid min-h-[38px] place-items-center text-[10px] font-medium text-faint">
              Tik op een segment voor fase en exact tijdstip
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
          {Object.values(PHASES).map((phase) => (
            <div key={phase.label} className="flex items-center gap-1.5 text-[9px] font-semibold text-faint">
              <span className="size-2 rounded-sm" style={{ backgroundColor: phase.color }} />
              {phase.label}
            </div>
          ))}
        </div>
          </>
        ) : (
          <div className="rounded-row border border-line bg-s2/70 px-4 py-5 text-center">
            <div className="text-[12px] font-semibold text-ink">Nog geen tijdlijn gesynchroniseerd</div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-faint">
              De slaapduur en fasetotalen zijn er wel. Na de volgende Garmin-sync verschijnen ook de exacte tijdstippen hier.
            </p>
          </div>
        )}
      </TabsContent>

      <TabsContent value="phases" className="mt-4">
        <PhaseTotals wellness={wellness} />
      </TabsContent>
    </Tabs>
  );
}
