// Verstuurt één melding naar alle geregistreerde toestellen.
//
// Wordt aangeroepen door de databasetrigger op `notifications`, niet door de
// app. Daardoor is "melding sturen" een INSERT: de worker, de webapp en een
// handmatige SQL-query gebruiken allemaal dezelfde weg, en er is één plek waar
// je achteraf kunt zien wat er is verstuurd en wat er misging.
//
// verify_jwt staat uit omdat de aanroeper een databasetrigger is en geen
// ingelogde gebruiker. In plaats daarvan bewijst de aanroeper zich met een
// gedeeld geheim dat in Vault staat; zonder dat geheim komt er niets langs.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const HOOK_SECRET = Deno.env.get("PUSH_HOOK_SECRET");
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:jaspervanzeir1@gmail.com";

// 404 en 410 betekenen: dit abonnement bestaat niet meer. Een uitgelogde of
// verwijderde PWA laat zo'n endpoint achter, en zonder opruimen blijft de
// functie er voorgoed tegenaan praten.
const GONE = new Set([404, 410]);

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function fout(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  // Eerst wie je bent, dan pas of alles is ingesteld: een onbekende beller
  // hoort niets te leren over de staat van de configuratie.
  if (!HOOK_SECRET || req.headers.get("x-push-hook-secret") !== HOOK_SECRET) {
    return fout(401, "ongeldig hookgeheim");
  }
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return fout(500, "VAPID-sleutels ontbreken in de functie-omgeving");
  }

  const { notification_id } = await req.json().catch(() => ({ notification_id: null }));
  if (typeof notification_id !== "number") {
    return fout(400, "notification_id ontbreekt");
  }

  const { data: melding, error: meldingError } = await admin
    .from("notifications")
    .select("id, kind, title, body, url, data, delivered_at")
    .eq("id", notification_id)
    .single();
  if (meldingError || !melding) return fout(404, "melding bestaat niet");
  if (melding.delivered_at) {
    return Response.json({ skipped: "al bezorgd", id: melding.id });
  }

  const { data: abonnementen, error: abonnementError } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth");
  if (abonnementError) return fout(500, abonnementError.message);
  if (!abonnementen?.length) {
    await admin
      .from("notifications")
      .update({ error: "geen enkel toestel is geabonneerd", delivered_count: 0 })
      .eq("id", melding.id);
    return Response.json({ sent: 0, reason: "geen abonnementen" });
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  const lading = JSON.stringify({
    title: melding.title,
    body: melding.body,
    url: melding.url,
    kind: melding.kind,
    data: melding.data,
  });

  let bezorgd = 0;
  const problemen: string[] = [];
  const verlopen: number[] = [];

  await Promise.all(
    abonnementen.map(async (abo) => {
      try {
        await webpush.sendNotification(
          { endpoint: abo.endpoint, keys: { p256dh: abo.p256dh, auth: abo.auth } },
          lading,
          { TTL: 3600, urgency: "normal" },
        );
        bezorgd++;
        await admin
          .from("push_subscriptions")
          .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
          .eq("id", abo.id);
      } catch (exc) {
        const status = (exc as { statusCode?: number }).statusCode ?? 0;
        if (GONE.has(status)) {
          verlopen.push(abo.id);
          return;
        }
        problemen.push(`toestel ${abo.id}: ${status || "onbekend"} ${(exc as Error).message}`);
        const { data: huidig } = await admin
          .from("push_subscriptions")
          .select("failure_count")
          .eq("id", abo.id)
          .single();
        await admin
          .from("push_subscriptions")
          .update({ failure_count: (huidig?.failure_count ?? 0) + 1 })
          .eq("id", abo.id);
      }
    }),
  );

  if (verlopen.length) {
    await admin.from("push_subscriptions").delete().in("id", verlopen);
  }

  await admin
    .from("notifications")
    .update({
      delivered_at: bezorgd > 0 ? new Date().toISOString() : null,
      delivered_count: bezorgd,
      error: problemen.length ? problemen.join("; ").slice(0, 1000) : null,
    })
    .eq("id", melding.id);

  return Response.json({
    sent: bezorgd,
    removed_expired: verlopen.length,
    errors: problemen,
  });
});
