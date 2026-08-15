"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Camera, LoaderCircle, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

// Wat de browser accepteert; de bucket dwingt dezelfde grenzen nog een keer af.
const TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 2 * 1024 * 1024;

// Een profielfoto wordt nergens groter dan 112 px getoond. 512 is ruim genoeg
// voor een scherm met hoge pixeldichtheid en houdt het bestand klein — een
// telefoonfoto van 4 MB verkleint hiermee tot enkele tientallen kB.
const SIDE = 512;

/** Snijd vierkant uit het midden en schaal terug. Scheelt uploadtijd, opslag,
 * en voorkomt dat een liggende foto scheef in de ronde lijst valt. */
async function toSquareWebp(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIDE;
  canvas.height = SIDE;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Je browser kan geen afbeeldingen bewerken.");
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    SIDE,
    SIDE,
  );
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.9),
  );
  if (!blob) throw new Error("De afbeelding kon niet worden omgezet.");
  return blob;
}

export function AvatarUpload({
  initials,
  signedUrl,
  hasAvatar,
  children,
}: {
  initials: string;
  signedUrl: string | null;
  hasAvatar: boolean;
  /** De naam- en badgeblok rechts van de foto; zo blijft het één rij. */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Meteen tonen wat je koos, zonder te wachten op upload en herladen.
  const [preview, setPreview] = React.useState<string | null>(null);

  React.useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  async function kies(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    if (!TYPES.includes(file.type)) {
      setError("Kies een JPG-, PNG- of WebP-bestand.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Die foto is groter dan 2 MB. Kies een kleinere.");
      return;
    }

    setBusy(true);
    try {
      const sb = createClient();
      const { data: auth } = await sb.auth.getUser();
      if (!auth.user) throw new Error("Je sessie is verlopen. Log opnieuw in.");

      const blob = await toSquareWebp(file);
      setPreview(URL.createObjectURL(blob));

      // Vaste bestandsnaam per gebruiker met upsert: zo blijft er nooit een
      // sliert oude foto's in de bucket achter.
      const path = `${auth.user.id}/avatar.webp`;
      const { error: uploadError } = await sb.storage
        .from("avatars")
        .upload(path, blob, { contentType: "image/webp", upsert: true });
      if (uploadError) throw new Error(uploadError.message);

      // Met .select() erbij zien we of er werkelijk een rij is geraakt. Zonder
      // dat slaagt een update die op nul rijen matcht geruisloos, en dan staat
      // de foto wel in de opslag maar verschijnt hij nergens.
      const { data: bijgewerkt, error: saveError } = await sb
        .from("athlete_profile")
        .update({ avatar_path: path })
        .eq("user_id", auth.user.id)
        .select("id");
      if (saveError) throw new Error(saveError.message);
      if (!bijgewerkt?.length) {
        throw new Error("Geen atletenprofiel gevonden dat aan je account hangt.");
      }

      router.refresh();
    } catch (exc) {
      setPreview(null);
      setError(exc instanceof Error ? exc.message : "Uploaden is niet gelukt.");
    } finally {
      setBusy(false);
    }
  }

  async function verwijder() {
    setBusy(true);
    setError(null);
    try {
      const sb = createClient();
      const { data: auth } = await sb.auth.getUser();
      if (!auth.user) throw new Error("Je sessie is verlopen. Log opnieuw in.");

      await sb.storage.from("avatars").remove([`${auth.user.id}/avatar.webp`]);
      const { data: bijgewerkt, error: saveError } = await sb
        .from("athlete_profile")
        .update({ avatar_path: null })
        .eq("user_id", auth.user.id)
        .select("id");
      if (saveError) throw new Error(saveError.message);
      if (!bijgewerkt?.length) {
        throw new Error("Geen atletenprofiel gevonden dat aan je account hangt.");
      }

      setPreview(null);
      router.refresh();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Verwijderen is niet gelukt.");
    } finally {
      setBusy(false);
    }
  }

  const bron = preview ?? signedUrl;

  return (
    <div>
      <div className="flex items-center gap-3.5">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          aria-label="Profielfoto wijzigen"
          className="surface-pressable focus-ring relative shrink-0 rounded-full"
        >
          <Avatar className="size-14">
            {bron && <AvatarImage src={bron} alt="" />}
            <AvatarFallback className="text-[15px]">{initials}</AvatarFallback>
          </Avatar>
          <span className="absolute -right-0.5 -bottom-0.5 grid size-6 place-items-center rounded-full border border-line-strong bg-s2 text-muted">
            {busy ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <Camera className="size-3" />
            )}
          </span>
        </button>

        <input
          ref={input}
          type="file"
          accept={TYPES.join(",")}
          onChange={kies}
          className="hidden"
        />

        {children && <div className="min-w-0 flex-1">{children}</div>}

        {(hasAvatar || preview) && (
          <Button
            variant="ghost"
            size="icon"
            onClick={verwijder}
            disabled={busy}
            aria-label="Profielfoto verwijderen"
            className="shrink-0"
          >
            <Trash2 />
          </Button>
        )}
      </div>

      {error && <p className="mt-2 text-xs leading-relaxed text-warning">{error}</p>}
    </div>
  );
}
