import type { Step } from "@/lib/queries";

/* Werk is de prikkel, warming-up en cooling-down zijn ondersteunend, herstel is
   afwezigheid van prikkel. Die drie rollen krijgen elk een eigen tint. */
const SEGMENT_COLOR: Record<string, string> = {
  warmup: "#7ba1bb",
  cooldown: "#7ba1bb",
  work: "#0093e7",
  run: "#0093e7",
  walk: "#303b41",
  recover: "#303b41",
  rest: "#303b41",
};

/** De vorm van de training in één balk: je ziet de intervalstructuur zonder
 *  de stappenlijst te openen. */
export function StructureBar({ steps, accent = "#0093e7" }: { steps: Step[]; accent?: string }) {
  const segments: { weight: number; color: string }[] = [];

  for (const step of steps) {
    const weight = step.duration_s || step.distance_m || 0;
    if (weight <= 0) continue;
    const color = step.type === "work" || step.type === "run"
      ? accent
      : SEGMENT_COLOR[step.type] ?? accent;
    for (let i = 0; i < Math.max(1, step.repeat); i++) {
      segments.push({ weight, color });
    }
  }

  if (segments.length < 2) return null;

  return (
    <div className="mt-4 flex h-2 gap-[2px]">
      {segments.map((seg, i) => (
        <div
          key={i}
          className="rounded-full"
          style={{ flex: seg.weight, background: seg.color }}
        />
      ))}
    </div>
  );
}
