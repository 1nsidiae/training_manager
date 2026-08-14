"use client";

import * as React from "react";
import { Bell, BellOff, LoaderCircle, Smartphone, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

type State =
  | "laden"
  | "niet_ondersteund"
  | "geen_pwa"
  | "geweigerd"
  | "uit"
  | "aan"
  | "bezig";

/** VAPID-sleutels zijn base64url; PushManager wil ruwe bytes. Teruggeven als
 * ArrayBuffer en niet als Uint8Array: die laatste kan volgens de types ook op
 * een SharedArrayBuffer zitten, en dat accepteert applicationServerKey niet. */
function keyToBuffer(base64url: string): ArrayBuffer {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  const raw = atob(padded);
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return buffer;
}

function keyToBase64(key: ArrayBuffer | null): string {
  if (!key) return "";
  return btoa(String.fromCharCode(...new Uint8Array(key)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** iOS levert push alleen af aan een PWA op het beginscherm, niet aan Safari.
 * Zonder deze controle vraagt de knop netjes toestemming en komt er daarna
 * nooit iets aan — het lijkt dan kapot terwijl het gedrag klopt. */
function iosZonderInstallatie(): boolean {
  if (typeof window === "undefined") return false;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!ios) return false;
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return !standalone;
}

export function PushToggle() {
  const [state, setState] = React.useState<State>("laden");
  const [melding, setMelding] = React.useState<string | null>(null);

  React.useEffect(() => {
    async function bepaalStand() {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        setState("niet_ondersteund");
        return;
      }
      if (iosZonderInstallatie()) {
        setState("geen_pwa");
        return;
      }
      if (Notification.permission === "denied") {
        setState("geweigerd");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const bestaand = await registration.pushManager.getSubscription();
      setState(bestaand ? "aan" : "uit");
    }
    bepaalStand().catch(() => setState("niet_ondersteund"));
  }, []);

  async function aanzetten() {
    setState("bezig");
    setMelding(null);
    try {
      if (!VAPID_PUBLIC_KEY) {
        throw new Error("NEXT_PUBLIC_VAPID_PUBLIC_KEY ontbreekt in de webomgeving.");
      }
      const toestemming = await Notification.requestPermission();
      if (toestemming !== "granted") {
        setState(toestemming === "denied" ? "geweigerd" : "uit");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const abonnement =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyToBuffer(VAPID_PUBLIC_KEY),
        }));

      const sb = createClient();
      const { data: auth } = await sb.auth.getUser();
      if (!auth.user) throw new Error("Je sessie is verlopen. Log opnieuw in.");

      // Op endpoint, niet op id: dezelfde browser opnieuw laten toestaan geeft
      // hetzelfde endpoint terug en mag geen tweede rij opleveren.
      const { error } = await sb.from("push_subscriptions").upsert(
        {
          user_id: auth.user.id,
          endpoint: abonnement.endpoint,
          p256dh: keyToBase64(abonnement.getKey("p256dh")),
          auth: keyToBase64(abonnement.getKey("auth")),
          user_agent: navigator.userAgent.slice(0, 300),
          failure_count: 0,
        },
        { onConflict: "endpoint" },
      );
      if (error) throw new Error(error.message);

      setState("aan");
      setMelding("Dit toestel krijgt vanaf nu meldingen.");
    } catch (exc) {
      setState("uit");
      setMelding(exc instanceof Error ? exc.message : "Aanzetten is niet gelukt.");
    }
  }

  async function uitzetten() {
    setState("bezig");
    setMelding(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const abonnement = await registration.pushManager.getSubscription();
      if (abonnement) {
        await createClient()
          .from("push_subscriptions")
          .delete()
          .eq("endpoint", abonnement.endpoint);
        await abonnement.unsubscribe();
      }
      setState("uit");
      setMelding("Dit toestel krijgt geen meldingen meer.");
    } catch (exc) {
      setState("aan");
      setMelding(exc instanceof Error ? exc.message : "Uitzetten is niet gelukt.");
    }
  }

  async function testen() {
    setMelding(null);
    const { error } = await createClient().rpc("send_test_notification");
    setMelding(
      error
        ? `Testmelding mislukt: ${error.message}`
        : "Testmelding verstuurd. Hij komt binnen enkele seconden aan.",
    );
  }

  const uitleg: Record<State, string> = {
    laden: "Stand van dit toestel wordt opgehaald.",
    niet_ondersteund: "Deze browser ondersteunt geen push-meldingen.",
    geen_pwa:
      "Op iPhone werkt push alleen vanuit de app op je beginscherm. Open het deelmenu in Safari en kies 'Zet op beginscherm', en zet meldingen daarna vanuit die app aan.",
    geweigerd:
      "Meldingen staan geblokkeerd voor deze site. Zet ze weer aan in de instellingen van je browser of telefoon.",
    uit: "Je krijgt bericht bij een nieuw schema, een bijstelling en wat je verder moet weten.",
    aan: "Dit toestel staat geregistreerd.",
    bezig: "Bezig…",
  };

  const badge =
    state === "aan"
      ? { label: "aan", variant: "teal" as const }
      : state === "geweigerd" || state === "niet_ondersteund"
        ? { label: "niet mogelijk", variant: "warning" as const }
        : state === "geen_pwa"
          ? { label: "installeer eerst", variant: "warning" as const }
          : { label: "uit", variant: "recovery" as const };

  const icoon =
    state === "bezig" || state === "laden" ? (
      <LoaderCircle className="size-[18px] animate-spin" />
    ) : state === "aan" ? (
      <Bell className="size-[18px]" />
    ) : state === "geen_pwa" ? (
      <Smartphone className="size-[18px]" />
    ) : state === "geweigerd" || state === "niet_ondersteund" ? (
      <TriangleAlert className="size-[18px]" />
    ) : (
      <BellOff className="size-[18px]" />
    );

  const toon =
    state === "aan"
      ? "bg-teal/10 text-teal"
      : state === "geweigerd" || state === "niet_ondersteund" || state === "geen_pwa"
        ? "bg-warning/10 text-warning"
        : "bg-recovery/10 text-recovery";

  return (
    <Card className="p-3.5">
      <div className="flex items-center gap-3">
        <div className={`grid size-10 shrink-0 place-items-center rounded-full ${toon}`}>
          {icoon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">Push-meldingen</div>
          <div className="mt-px text-[11px] text-faint">dit toestel</div>
        </div>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted">{uitleg[state]}</p>

      {(state === "uit" || state === "aan" || state === "bezig") && (
        <div className="mt-3 flex gap-2">
          {state === "aan" ? (
            <>
              <Button variant="secondary" onClick={uitzetten} className="flex-1">
                Uitzetten
              </Button>
              <Button variant="secondary" onClick={testen} className="flex-1">
                Testmelding
              </Button>
            </>
          ) : (
            <Button onClick={aanzetten} disabled={state === "bezig"} className="flex-1">
              Meldingen aanzetten
            </Button>
          )}
        </div>
      )}

      {melding && <p className="mt-2.5 text-xs leading-relaxed text-muted">{melding}</p>}
    </Card>
  );
}
