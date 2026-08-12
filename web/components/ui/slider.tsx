"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

function Slider({
  className,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex h-8 w-full touch-none select-none items-center data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-s3">
        <SliderPrimitive.Range className="absolute h-full bg-teal" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="focus-ring block size-5 rounded-full border-2 border-s1 bg-teal shadow-[0_0_0_1px_rgb(255_255_255/0.18)]" />
    </SliderPrimitive.Root>
  );
}

export { Slider };
