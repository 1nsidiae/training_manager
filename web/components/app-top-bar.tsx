import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAthlete, getAvatarUrl } from "@/lib/queries";

export async function AppTopBar({
  title,
  action,
  showAvatar = true,
}: {
  title: string;
  action?: React.ReactNode;
  /** Uit op de profielpagina zelf: daar staat de grote, bewerkbare avatar al
   * en zou deze knop naar de pagina linken waar je al bent. De lege kolom
   * blijft staan, zodat de titel gecentreerd blijft met de andere schermen. */
  showAvatar?: boolean;
}) {
  const athlete = showAvatar ? await getAthlete() : null;
  const avatarUrl = await getAvatarUrl(athlete?.avatar_path);
  const initials = (athlete?.display_name ?? "?")
    .split(" ")
    .map((deel: string) => deel[0])
    .slice(0, 2)
    .join("");

  return (
    <nav
      aria-label={`${title} navigatie`}
      className="grid min-h-11 grid-cols-[40px_minmax(0,1fr)_52px] items-center gap-3"
    >
      {showAvatar ? (
        <Link href="/profiel" aria-label="Open je profiel" className="focus-ring rounded-full">
          <Avatar className="size-10 border-line bg-transparent">
            {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
            <AvatarFallback className="text-[11px] font-semibold">{initials}</AvatarFallback>
          </Avatar>
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}

      <div className="truncate text-center text-[15px] font-semibold tracking-[-0.02em] text-ink">
        {title}
      </div>

      <div className="grid h-10 w-[52px] place-items-center justify-self-end">
        {action ?? <span aria-hidden="true" />}
      </div>
    </nav>
  );
}
