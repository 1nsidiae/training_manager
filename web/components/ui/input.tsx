import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "h-12 w-full rounded-xl border border-line bg-s2 px-3.5 text-sm text-ink outline-none transition-colors placeholder:text-off focus:border-line-strong focus:ring-2 focus:ring-ink/10 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
