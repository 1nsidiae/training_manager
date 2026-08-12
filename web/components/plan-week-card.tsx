"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export function PlanWeekCard({
  header,
  preview,
  children,
  defaultOpen = false,
}: {
  header: React.ReactNode;
  preview: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-card border border-line bg-s1 px-3.5 pb-4 pt-2.5 data-[state=open]:border-line-strong data-[state=open]:pb-3.5">
      <CollapsibleTrigger className="focus-ring flex min-h-10 w-full items-center gap-3 rounded-xl text-left">
        <div className="min-w-0 flex-1">{header}</div>
        <ChevronDown className={cn("size-4 shrink-0 text-faint transition-transform duration-200", open && "rotate-180 text-ink")} />
      </CollapsibleTrigger>
      {!open ? <div className="pt-2 pb-0.5">{preview}</div> : null}
      <CollapsibleContent className="data-[state=closed]:animate-none">
        <div className="pt-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
