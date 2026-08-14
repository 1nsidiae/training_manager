"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { nlBE } from "react-day-picker/locale";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SyncButton } from "@/components/sync-button";

export function TodayHeader({
  initials,
  lastSyncAt,
  selectedDay,
  today,
}: {
  initials: string;
  lastSyncAt?: string | null;
  selectedDay: string;
  today: string;
}) {
  const router = useRouter();
  const [calendarOpen, setCalendarOpen] = React.useState(false);
  const selectedDate = new Date(`${selectedDay}T12:00:00`);
  const todayDate = new Date(`${today}T12:00:00`);
  const label = selectedDate.toLocaleDateString("nl-BE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const previousDate = new Date(selectedDate);
  previousDate.setDate(previousDate.getDate() - 1);
  const previousDay = previousDate.toISOString().slice(0, 10);
  const nextDate = new Date(selectedDate);
  nextDate.setDate(nextDate.getDate() + 1);
  const nextDay = nextDate.toISOString().slice(0, 10);
  const isToday = selectedDay === today;
  const yesterdayDate = new Date(`${today}T12:00:00`);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toISOString().slice(0, 10);
  const relativeLabel = isToday
    ? "Vandaag"
    : selectedDay === yesterday
      ? "Gisteren"
      : selectedDate.toLocaleDateString("nl-BE", { weekday: "long" });

  function chooseDay(date: Date | undefined) {
    if (!date) return;
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Brussels",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
    setCalendarOpen(false);
    router.push(day === today ? "/" : `/?day=${day}`, { scroll: false });
  }

  return (
    <header className="grid min-h-11 grid-cols-[40px_minmax(0,1fr)_52px] items-center gap-3">
      <Link
        href="/profiel"
        aria-label="Open je profiel"
        className="focus-ring rounded-full"
      >
        <Avatar className="size-10 border-line bg-transparent">
          <AvatarFallback className="text-[11px] font-semibold">{initials}</AvatarFallback>
        </Avatar>
      </Link>

      <div className="flex items-center justify-self-center">
        <Button asChild variant="ghost" size="icon" className="min-h-8 size-8 shrink-0 rounded-full p-0 text-faint">
          <Link href={`/?day=${previousDay}`} aria-label="Vorige dag" scroll={false}>
            <ChevronLeft className="size-4" />
          </Link>
        </Button>
        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="focus-ring w-[92px] rounded-full bg-s2/65 px-2 py-1 text-center transition-colors hover:bg-s3"
              aria-label={`Open kalender, geselecteerd: ${label}`}
            >
              <span className="block truncate text-[8px] font-bold uppercase tracking-[0.11em] text-faint">
                {relativeLabel}
              </span>
              <time dateTime={selectedDay} className="block truncate text-[11px] font-semibold capitalize text-ink">
                {label}
              </time>
            </button>
          </PopoverTrigger>
          <PopoverContent align="center" sideOffset={10} collisionPadding={12} className="w-auto p-0">
            <Calendar
              mode="single"
              selected={selectedDate}
              defaultMonth={selectedDate}
              onSelect={chooseDay}
              disabled={{ after: todayDate }}
              endMonth={todayDate}
              locale={nlBE}
              weekStartsOn={1}
              timeZone="Europe/Brussels"
              autoFocus
            />
            {!isToday ? (
              <div className="border-t border-line p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full min-h-8 text-[9px] text-teal"
                  onClick={() => chooseDay(todayDate)}
                >
                  Ga naar vandaag
                </Button>
              </div>
            ) : null}
          </PopoverContent>
        </Popover>
        {isToday ? (
          <Button variant="ghost" size="icon" className="min-h-8 size-8 shrink-0 rounded-full p-0 text-off" aria-label="Volgende dag" disabled>
            <ChevronRight className="size-4" />
          </Button>
        ) : (
          <Button asChild variant="ghost" size="icon" className="min-h-8 size-8 shrink-0 rounded-full p-0 text-faint">
            <Link href={nextDay === today ? "/" : `/?day=${nextDay}`} aria-label="Volgende dag" scroll={false}>
              <ChevronRight className="size-4" />
            </Link>
          </Button>
        )}
      </div>

      <div className="grid h-10 w-[52px] place-items-center justify-self-end">
        <SyncButton lastSyncAt={lastSyncAt} />
      </div>
    </header>
  );
}
