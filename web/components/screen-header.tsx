import Link from "next/link";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ScreenHeader({
  eyebrow,
  title,
  description,
  backHref,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  backHref?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex items-start gap-3">
      {backHref ? (
        <Button asChild variant="icon" size="icon" className="mt-0.5">
          <Link href={backHref} aria-label="Terug">
            <ArrowLeft />
          </Link>
        </Button>
      ) : null}
      <div className="min-w-0 flex-1">
        {eyebrow ? <div className="label mb-1">{eyebrow}</div> : null}
        <h1 className="screen-title">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      {action ?? (
        <Button variant="ghost" size="icon" aria-label="Meer opties" className="-mr-2 text-faint">
          <MoreHorizontal />
        </Button>
      )}
    </header>
  );
}
