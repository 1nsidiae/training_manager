import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full resize-none rounded-xl border border-line bg-s2 px-3.5 py-3 text-sm leading-relaxed text-ink outline-none transition-colors placeholder:text-off focus:border-line-strong focus:ring-2 focus:ring-ink/10 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
