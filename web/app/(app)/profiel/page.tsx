import { Watch } from "lucide-react";
import { AppTopBar } from "@/components/app-top-bar";
import { PushToggle } from "@/components/push-toggle";
import { ScreenHeader } from "@/components/screen-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getAthlete, getFitness, getLastSync, getLatestVo2Max } from "@/lib/queries";
import { ZONE_COLORS } from "@/lib/format";

export const dynamic = "force-dynamic";

const SYNC_STATE = {
  ok: { label: "in orde", badge: "in orde", variant: "teal" as const, tone: "bg-teal/10 text-teal" },
  busy: { label: "bezig", badge: "bezig", variant: "recovery" as const, tone: "bg-recovery/10 text-recovery" },
  error: { label: "mislukt", badge: "check", variant: "warning" as const, tone: "bg-warning/10 text-warning" },
  unknown: { label: "onbekend", badge: "check", variant: "warning" as const, tone: "bg-warning/10 text-warning" },
};

function syncStateOf(status: string | null | undefined): keyof typeof SYNC_STATE {
  if (status === "ok") return "ok";
  if (status === "requested" || status === "running") return "busy";
  if (status) return "error";
  return "unknown";
}

function mmss(seconds: number | null | undefined) {
  if (!seconds) return "–";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export default async function ProfilePage() {
  const [athlete, fitness, vo2, sync] = await Promise.all([
    getAthlete(),
    getFitness(),
    getLatestVo2Max(),
    getLastSync(),
  ]);

  const syncState = syncStateOf(sync?.status);
  const current = fitness.find((f) => f.scope === "current");
  const historical = fitness.find((f) => f.scope === "historical");
  const zones = (athlete?.hr_zones ?? []) as { zone: number; low: number; high: number }[];
  const easyCap = zones.find((zone) => zone.zone === 2)?.high;
  const zoneFourCap = zones.find((zone) => zone.zone === 4)?.high;
  const zoneSource = athlete?.hr_zones_source === "activity"
    ? "Garmin · activiteiten"
    : athlete?.hr_zones_source
      ? `Garmin · ${athlete.hr_zones_source}`
      : "Garmin";

  return (
    <main className="space-y-5">
      <AppTopBar title="Profiel" />
      <ScreenHeader eyebrow="Atleetprofiel" title={athlete?.display_name ?? "Onbekend"} action={<Badge variant="teal" className="mt-1">Garmin</Badge>} />

      {/* Hartslagzones: de basis onder elke sessie in dit plan. */}
      <Card className="p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="label">Hartslagzones</span>
          <span className="text-[10px] font-medium text-faint">{zoneSource}</span>
        </div>

        <div className="mt-3 grid grid-cols-3 divide-x divide-line overflow-hidden rounded-row bg-s2">
          <Stat label="Max-HR" value={athlete?.max_hr ?? "–"} unit="bpm" />
          <Stat label="Rust-HR" value={athlete?.resting_hr ?? "–"} unit="bpm" />
          <Stat label="Drempel" value={athlete?.lactate_threshold_hr ?? "–"} unit="bpm" />
        </div>

        {zones.length ? (
          <>
            <div className="mt-4 grid h-2 grid-cols-5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
              {zones.map((zone) => (
                <span key={zone.zone} style={{ background: ZONE_COLORS[zone.zone - 1] }} />
              ))}
            </div>

            <div className="mt-2 divide-y divide-line">
              {zones.map((zone) => (
                <div key={zone.zone} className="flex items-center gap-2.5 py-2">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: ZONE_COLORS[zone.zone - 1] }}
                    aria-hidden="true"
                  />
                  <span className="flex-1 text-[11px] font-medium text-muted">Zone {zone.zone}</span>
                  <span className="numeral text-[11px] font-semibold text-ink">
                    {zone.low}–{zone.high} <span className="font-normal text-faint">bpm</span>
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-2 flex items-end justify-between gap-4 border-t border-line pt-3">
              <div>
                <div className="label text-[9px]">Rustige bovengrens</div>
                <div className="mt-1 text-[10px] text-faint">Bovenkant van zone 2</div>
              </div>
              <div className="numeral text-xl font-bold text-recovery">
                ≤ {easyCap ?? "–"}<span className="ml-1 text-[10px] font-medium text-faint">bpm</span>
              </div>
            </div>

            <p className="mt-3 text-[10px] leading-relaxed text-muted">
              Zone 4 eindigt op {zoneFourCap ?? "–"} bpm en blijft onder je drempel van{" "}
              {athlete?.lactate_threshold_hr ?? "–"} bpm.
            </p>
          </>
        ) : (
          <p className="mt-3 text-[11px] leading-relaxed text-muted">
            Garmin heeft nog geen hartslagzones gesynchroniseerd.
          </p>
        )}
      </Card>

      {/* Vorm */}
      <Card className="p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="label">Vormschatting</span>
          {current && (
            <span className="text-[11px] font-medium text-faint">
              n = {current.sample_size}
            </span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: "5 km", now: current?.equiv_5k_s, ever: historical?.equiv_5k_s },
            { label: "10 km", now: current?.equiv_10k_s, ever: historical?.equiv_10k_s },
            { label: "Halve", now: current?.equiv_half_s, ever: historical?.equiv_half_s },
          ].map((d) => (
            <div key={d.label} className="row px-2 py-3">
              <div className="text-[10px] font-medium text-faint">{d.label}</div>
              <div className="numeral mt-1.5 text-lg font-bold">{mmss(d.now)}</div>
              <div className="mt-1 text-[10px] text-faint">ooit {mmss(d.ever)}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
          <span className="text-[13px] text-muted">VO2max</span>
          <span className="numeral text-lg font-bold">
            {vo2?.vo2max_running ? Number(vo2.vo2max_running).toFixed(0) : "–"}
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Streepjes betekenen te weinig data voor die afstand. Geen schatting is
          bruikbaarder dan een verzonnen getal.
        </p>
      </Card>

      {/* Sync — 'requested' en 'running' zijn geen storing maar een sync die
          nog loopt; die mogen hier niet als waarschuwing binnenkomen. */}
      <Card className="flex items-center gap-3 p-3.5">
        <div className={`grid size-10 shrink-0 place-items-center rounded-full ${SYNC_STATE[syncState].tone}`}>
          <Watch className="size-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">
            Garmin-sync {SYNC_STATE[syncState].label}
          </div>
          <div className="numeral mt-px text-[11px] text-faint">
            {sync?.finished_at
              ? `${sync.sync_type} · ${new Date(sync.finished_at).toLocaleString("nl-BE", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : sync
                ? `${sync.sync_type} · bezig`
                : "nog niet gedraaid"}
          </div>
        </div>
        <Badge variant={SYNC_STATE[syncState].variant}>{SYNC_STATE[syncState].badge}</Badge>
      </Card>

      <PushToggle />
    </main>
  );
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string | number;
  unit?: string;
}) {
  return (
    <div className="px-3 py-3">
      <div className="text-[10px] font-medium text-faint">{label}</div>
      <div className="numeral mt-1 text-lg font-bold">
        {value}
        {unit && <span className="ml-0.5 text-[10px] font-normal text-faint">{unit}</span>}
      </div>
    </div>
  );
}
