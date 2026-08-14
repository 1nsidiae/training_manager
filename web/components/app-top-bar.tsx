import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function AppTopBar({
  title,
  initials = "JV",
  action,
}: {
  title: string;
  initials?: string;
  action?: React.ReactNode;
}) {
  return (
    <nav
      aria-label={`${title} navigatie`}
      className="grid min-h-11 grid-cols-[40px_minmax(0,1fr)_52px] items-center gap-3"
    >
      <Link href="/profiel" aria-label="Open je profiel" className="focus-ring rounded-full">
        <Avatar className="size-10 border-line bg-transparent">
          <AvatarFallback className="text-[11px] font-semibold">{initials}</AvatarFallback>
        </Avatar>
      </Link>

      <div className="truncate text-center text-[15px] font-semibold tracking-[-0.02em] text-ink">
        {title}
      </div>

      <div className="grid h-10 w-[52px] place-items-center justify-self-end">
        {action ?? <span aria-hidden="true" />}
      </div>
    </nav>
  );
}
