import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl text-[11px] font-bold uppercase tracking-[0.1em] transition-[background-color,color,transform,border-color] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ink/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-45 active:scale-[0.985] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-ink px-4 text-canvas hover:bg-white",
        secondary: "border border-line bg-s2 px-4 text-ink hover:bg-s3",
        ghost: "px-3 text-muted hover:bg-s2 hover:text-ink",
        metric: "border border-teal/25 bg-teal/10 px-4 text-teal hover:bg-teal/15",
        icon: "size-11 rounded-full border border-line bg-s2 text-ink hover:bg-s3",
      },
      size: {
        default: "h-11",
        sm: "min-h-9 rounded-lg px-3 text-xs",
        lg: "h-12 rounded-[14px] px-5",
        icon: "size-11 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
