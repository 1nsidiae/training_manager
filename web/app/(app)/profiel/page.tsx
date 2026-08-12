import { Watch } from "lucide-react";
import { ScreenHeader } from "@/components/screen-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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

  return (
    <main className="space-y-5">
      <div className="flex items-center gap-3.5">
        <Avatar className="size-14">
          <AvatarFallback className="text-[15px]">
            {(athlete?.display_name ?? "?")
              .split(" ")
              .map((p: string) => p[0])
              .slice(0, 2)
              .join("")}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <ScreenHeader eyebrow="Atleetprofiel" title={athlete?.display_name ?? "Onbekend"} action={<Badge variant="teal" className="mt-1">Garmin</Badge>} />
        </div>
      </div>

      {/* Hartslagzones: de basis onder elke sessie in dit plan. */}
      <Card className="p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="label">Hartslagzones</span>
          <span className="text-[11px] font-medium text-faint">
            bron: {athlete?.hr_zones_source ?? "—"}
          </span>
        </div>

        <div className="mb-3 flex gap-4">
          <Stat label="Max-HR" value={athlete?.max_hr ?? "–"} unit="bpm" />
          <Stat label="Rust-HR" value={athlete?.resting_hr ?? "–"} unit="bpm" />
          <Stat label="Drempel" value={athlete?.lactate_threshold_hr ?? "–"} unit="bpm" />
        </div>

        <div className="space-y-1">
          {zones.map((z) => (
            <div key={z.zone} className="flex items-center gap-2.5">
              <span className="w-10 shrink-0 text-[11px] font-medium text-faint">
                Zone {z.zone}
              </span>
              <div
                className="h-1.5 flex-1 rounded-full"
                style={{ background: ZONE_COLORS[z.zone - 1] }}
              />
              <span className="numeral w-[70px] shrink-0 text-right text-[11px] text-muted">
                {z.low}–{z.high}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-3 text-xs leading-relaxed text-muted">
          Rustig lopen betekent voor jou onder {zones.find((z) => z.zone === 2)?.high ?? "–"}{" "}
          bpm. Je zone 4 loopt tot {zones.find((z) => z.zone === 4)?.high ?? "–"} en ligt
          daarmee onder je drempel van {athlete?.lactate_threshold_hr ?? "–"}.
        </p>
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
    <div>
      <div className="text-[10px] font-medium text-faint">{label}</div>
      <div className="numeral mt-1 text-lg font-bold">
        {value}
        {unit && <span className="ml-0.5 text-[10px] font-normal text-faint">{unit}</span>}
      </div>
    </div>
  );
}
