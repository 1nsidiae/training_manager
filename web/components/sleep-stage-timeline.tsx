"use client";

import { useMemo, useState } from "react";
import { Clock3 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hours } from "@/lib/format";
import type { Wellness } from "@/lib/queries";

type SleepLevel = NonNullable<NonNullable<Wellness["raw"]>["sleep_detail"]>["levels"][number];

const PHASES = {
  0: { label: "Diep", fullLabel: "Diepe slaap", color: "#586267", top: 79 },
  1: { label: "Licht", fullLabel: "Lichte slaap", color: "#7ba1bb", top: 54 },
  2: { label: "REM", fullLabel: "REM-slaap", color: "#67aee6", top: 29 },
  3: { label: "Wakker", fullLabel: "Wakker", color: "#b8c0c3", top: 4 },
} as const;

const PHASE_ORDER = [3, 2, 1, 0] as const;

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
    { ...PHASES[0], value: wellness.sleep_deep_s },
    { ...PHASES[1], value: wellness.sleep_light_s },
    { ...PHASES[2], value: wellness.sleep_rem_s },
    { ...PHASES[3], value: wellness.sleep_awake_s },
  ];
  const asleep = phases.slice(0, 3).reduce((sum, phase) => sum + (phase.value ?? 0), 0);
  const windowDuration = phases.reduce((sum, phase) => sum + (phase.value ?? 0), 0);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="label">Verdeling</div>
        <div className="micro">Garmin-slaapfasen</div>
      </div>

      <div className="flex h-2 gap-px overflow-hidden rounded-full bg-s3/60" aria-hidden="true">
        {phases.map((phase) => (
          <span
            key={phase.label}
            style={{
              width: `${windowDuration ? ((phase.value ?? 0) / windowDuration) * 100 : 0}%`,
              backgroundColor: phase.color,
            }}
          />
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {phases.map((phase) => {
          const share = asleep && phase.label !== "Wakker" ? ((phase.value ?? 0) / asleep) * 100 : null;
          return (
            <div key={phase.label} className="row min-w-0 p-3">
              <div className="flex items-center gap-2">
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: phase.color }} />
                <span className="truncate text-[10px] font-semibold text-muted">{phase.fullLabel}</span>
              </div>
              <div className="numeral mt-2 text-[18px] font-semibold">{hours(phase.value)}</div>
              <div className="micro mt-1">
                {share != null ? `${share.toFixed(0)}% van slaaptijd` : "Tijd wakker"}
              </div>
            </div>
          );
        })}
      </div>
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
      <TabsList>
        <TabsTrigger value="timeline">Tijdlijn</TabsTrigger>
        <TabsTrigger value="phases">Fasen</TabsTrigger>
      </TabsList>

      <TabsContent value="timeline" className="mt-4">
        {normalized.length ? (
          <>
        <div className="mb-3 flex items-end justify-between gap-3 px-0.5">
          <div>
            <div className="label">Slaapverloop</div>
            <div className="mt-1 text-[12px] font-semibold text-muted">
              {start ? timeLabel(start) : "–"}–{end ? timeLabel(end) : "–"}
            </div>
          </div>
          <div className="micro">Tik voor details</div>
        </div>

        <div className="grid grid-cols-[38px_1fr] gap-2.5">
          <div className="relative h-[132px] text-[8px] font-bold uppercase tracking-[0.06em] text-faint">
            {PHASE_ORDER.map((level) => (
              <span key={level} className="absolute right-0 -translate-y-1/2" style={{ top: `${PHASES[level].top + 8}%` }}>
                {PHASES[level].label}
              </span>
            ))}
          </div>

          <div className="relative h-[132px] overflow-hidden rounded-card bg-s2/55 px-1">
            {PHASE_ORDER.map((level) => (
              <span
                key={level}
                className="pointer-events-none absolute inset-x-2 h-px bg-line"
                style={{ top: `${PHASES[level].top + 8}%` }}
              />
            ))}

            {normalized.slice(1).map((level, index) => {
              const previous = normalized[index];
              const previousPhase = PHASES[previous.level as keyof typeof PHASES];
              const phase = PHASES[level.level as keyof typeof PHASES];
              const left = duration ? ((level.start - start) / duration) * 100 : 0;
              const from = previousPhase.top + 8;
              const to = phase.top + 8;
              return (
                <span
                  key={`connector-${level.start_gmt}-${index}`}
                  className="pointer-events-none absolute w-px bg-line-strong"
                  style={{ left: `${left}%`, top: `${Math.min(from, to)}%`, height: `${Math.abs(to - from)}%` }}
                />
              );
            })}

            {normalized.map((level, index) => {
              const phase = PHASES[level.level as keyof typeof PHASES];
              const left = duration ? ((level.start - start) / duration) * 100 : 0;
              const width = duration ? ((level.end - level.start) / duration) * 100 : 0;
              const isActive = active === level;
              return (
                <button
                  key={`${level.start_gmt}-${index}`}
                  type="button"
                  className="focus-ring absolute min-w-[2px] rounded-[4px] transition-[filter,opacity,transform] focus-visible:z-10"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    top: `${phase.top}%`,
                    height: "16%",
                    backgroundColor: phase.color,
                    opacity: active && !isActive ? 0.3 : 1,
                    filter: isActive ? "brightness(1.16)" : undefined,
                    transform: isActive ? "translateY(-1px) scaleY(1.12)" : undefined,
                    zIndex: isActive ? 2 : 1,
                  }}
                  aria-label={`${phase.label}, ${timeLabel(level.start)} tot ${timeLabel(level.end)}, ${durationLabel(level.start, level.end)}`}
                  aria-pressed={selected === level}
                  onClick={() => setSelected(level)}
                  onPointerEnter={(event) => {
                    if (event.pointerType === "mouse") setHovered(level);
                  }}
                  onPointerLeave={() => setHovered(null)}
                />
              );
            })}
          </div>
        </div>

        <div className="ml-[48px] mt-2 flex justify-between text-[9px] font-semibold text-faint">
          <span>{start ? timeLabel(start) : "–"}</span>
          <span>{start && duration ? timeLabel(start + duration / 2) : "–"}</span>
          <span>{end ? timeLabel(end) : "–"}</span>
        </div>

        <div className="row mt-4 min-h-[58px] px-3 py-2.5" aria-live="polite">
          {active ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: PHASES[active.level as keyof typeof PHASES].color }} />
                <div>
                  <div className="text-[12px] font-semibold">{PHASES[active.level as keyof typeof PHASES].fullLabel}</div>
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
