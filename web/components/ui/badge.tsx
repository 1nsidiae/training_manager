import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[9px] font-bold uppercase tracking-[0.08em] whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-line bg-s2 text-muted",
        teal: "border-teal/25 bg-teal/10 text-teal",
        positive: "border-high/25 bg-high/10 text-high",
        recovery: "border-recovery/25 bg-recovery/10 text-recovery",
        strain: "border-strain/25 bg-strain/10 text-strain",
        sleep: "border-sleep/25 bg-sleep/10 text-sleep",
        warning: "border-warning/25 bg-warning/10 text-warning",
        danger: "border-danger/25 bg-danger/10 text-danger",
        outline: "border-line-strong bg-transparent text-muted",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";
  return <Comp className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
