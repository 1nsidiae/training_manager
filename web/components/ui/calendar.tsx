"use client";

import * as React from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, getDefaultClassNames, type DayButton } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  components,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  const defaultClassNames = getDefaultClassNames();

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      captionLayout={captionLayout}
      className={cn("w-fit p-3 [--cell-size:2rem]", className)}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn("relative flex flex-col", defaultClassNames.months),
        month: cn("flex w-full flex-col gap-3", defaultClassNames.month),
        nav: cn(
          "absolute inset-x-0 top-0 flex h-(--cell-size) items-center justify-between",
          defaultClassNames.nav,
        ),
        button_previous: cn(
          "focus-ring grid size-(--cell-size) place-items-center rounded-full text-faint transition-colors hover:bg-s2 hover:text-ink disabled:opacity-35",
          defaultClassNames.button_previous,
        ),
        button_next: cn(
          "focus-ring grid size-(--cell-size) place-items-center rounded-full text-faint transition-colors hover:bg-s2 hover:text-ink disabled:opacity-35",
          defaultClassNames.button_next,
        ),
        month_caption: cn(
          "flex h-(--cell-size) items-center justify-center px-9",
          defaultClassNames.month_caption,
        ),
        caption_label: cn(
          "select-none text-[12px] font-semibold capitalize tracking-[-0.01em] text-ink",
          defaultClassNames.caption_label,
        ),
        month_grid: cn("w-full border-collapse", defaultClassNames.month_grid),
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          "flex size-(--cell-size) items-center justify-center text-[9px] font-semibold uppercase text-faint",
          defaultClassNames.weekday,
        ),
        week: cn("mt-1 flex w-full", defaultClassNames.week),
        day: cn(
          "group/day relative size-(--cell-size) p-0 text-center",
          defaultClassNames.day,
        ),
        today: cn("text-teal", defaultClassNames.today),
        outside: cn("text-off", defaultClassNames.outside),
        disabled: cn("pointer-events-none text-off opacity-30", defaultClassNames.disabled),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Chevron: ({ className: iconClassName, orientation, ...iconProps }) => {
          if (orientation === "left") {
            return <ChevronLeft className={cn("size-3.5", iconClassName)} {...iconProps} />;
          }
          if (orientation === "right") {
            return <ChevronRight className={cn("size-3.5", iconClassName)} {...iconProps} />;
          }
          return <ChevronDown className={cn("size-3.5", iconClassName)} {...iconProps} />;
        },
        DayButton: CalendarDayButton,
        ...components,
      }}
      {...props}
    />
  );
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const ref = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString("nl-BE")}
      data-selected-single={modifiers.selected}
      className={cn(
        "size-(--cell-size) min-h-(--cell-size) rounded-full p-0 text-[11px] font-semibold tracking-normal text-muted hover:bg-s2 hover:text-ink data-[selected-single=true]:bg-teal data-[selected-single=true]:text-canvas data-[selected-single=true]:ring-0",
        className,
      )}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };
