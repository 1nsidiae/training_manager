# Push-meldingen

## Hoe het werkt

Een melding versturen is **een rij schrijven**. Verder niets.

```
notifications INSERT
      │
      ├─ trigger notifications_push
      │     └─ dispatch_notification()  ─ leest het gedeelde geheim uit Vault
      │            └─ net.http_post ────────────────┐
      │                                             ▼
      │                              Edge Function  send-push
      │                                 ├─ controleert x-push-hook-secret
      │                                 ├─ leest alle push_subscriptions
      │                                 ├─ verstuurt Web Push met VAPID
      │                                 └─ schrijft delivered_at / error terug
      │
      └─ pg_cron elke 5 min: retry_pending_notifications()
```

Supabase heeft geen eigen push-dienst — Web Push is een browserstandaard en gaat
rechtstreeks naar Apple, Google of Mozilla. Wat Supabase hier levert is de
plumbing eromheen: de trigger, de functie en de opslag.

Waarom via de database en niet rechtstreeks vanuit de worker: nu kan élke
schrijver een melding sturen — de worker, de webapp, of jij met een SQL-query —
en is er één plek waar je achteraf ziet wat er verstuurd is en wat er misging.
De worker hoeft er ook niet voor te draaien.

## Wat je krijgt

| soort | wanneer | waar het vandaan komt |
|---|---|---|
| `plan_ready` | een nieuw plan is opgeslagen (voorstel of meteen actief) | `tm_coach/engine.py` |
| `plan_adjusted` | de pijn- of readinessregel heeft een sessie verzacht | `tm_worker/adjust.py` |
| `session_today` | er staat vandaag een training, vanaf 07:00 | `tm_worker/reminders.py` |
| `feedback_request` | een gelopen sessie wacht nog op je oordeel | `tm_worker/reminders.py` |
| `sync_problem` | je Garmin-tokens verlopen bijna | `tm_worker/reminders.py` |

Elke melding heeft een `dedupe_key` die uniek is in de database. De worker
draait elk half uur en ziet telkens dezelfde toestand; zonder die sleutel zou
"je hebt vandaag een sessie" achtenveertig keer trillen.

## Eenmalige instelling

### 1. Secrets bij de Edge Function

Dashboard → **Edge Functions** → `send-push` → **Secrets**. Zet deze drie:

```
VAPID_PUBLIC_KEY   = BNrjTeUzCQYDZceOw9GE-o8QoK7Td0WvC6143vRm2wdcj9IgR-YdRui1SFS30vaKsj9KOWwIRZ_-uIfHMBsCNzg
VAPID_PRIVATE_KEY  = <de private key, zie hieronder>
PUSH_HOOK_SECRET   = <het hookgeheim, zie hieronder>
```

`VAPID_SUBJECT` is optioneel en staat standaard op je e-mailadres.

De private key en het hookgeheim staan **niet in deze repo**. Ze zijn eenmalig
gegenereerd en aan jou doorgegeven; het hookgeheim staat ook in Vault onder de
naam `push_hook_secret`, waar de databasetrigger het leest.

Nieuwe sleutels nodig? Dan moet elk toestel zich opnieuw abonneren:

```bash
uv run python -c "import base64,secrets;from cryptography.hazmat.primitives.asymmetric import ec;from cryptography.hazmat.primitives import serialization;b=lambda r:base64.urlsafe_b64encode(r).decode().rstrip('=');k=ec.generate_private_key(ec.SECP256R1());print('public ',b(k.public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint)));print('private',b(k.private_numbers().private_value.to_bytes(32,'big')));print('hook   ',secrets.token_urlsafe(32))"
```

### 2. Publieke sleutel in de webomgeving

`web/.env.local` (lokaal) en `.env.production` op de VPS:

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BNrjTeUzCQYDZceOw9GE-o8QoK7Td0WvC6143vRm2wdcj9IgR-YdRui1SFS30vaKsj9KOWwIRZ_-uIfHMBsCNzg
```

Dit is de publieke helft — die hoort in de browser en is geen geheim.

### 3. Aanzetten op je telefoon

**Op iPhone werkt web push alleen vanuit een PWA op je beginscherm.** In Safari
als gewoon tabblad komt er niets aan, hoe goed alles verder ook staat. Dus:
deelmenu → *Zet op beginscherm* → open de app dáárvandaan → Profiel →
**Meldingen aanzetten**. De knop herkent dit zelf en zegt het als je nog in
Safari zit.

Daarna: **Testmelding**. Komt die aan, dan werkt de hele keten.

## Nakijken wat er gebeurd is

```sql
-- de laatste meldingen en hoe ze afliepen
select id, kind, title, created_at, dispatched_at, delivered_at,
       delivered_count, attempts, error
from notifications order by id desc limit 20;

-- wat de Edge Function terugstuurde
select id, status_code, left(content, 300), created
from net._http_response order by id desc limit 10;

-- welke toestellen geabonneerd zijn
select id, left(endpoint, 60) as endpoint, user_agent,
       last_success_at, failure_count
from push_subscriptions;
```

`delivered_at is null` met een gevulde `error` betekent: bezorgd noch bezorgbaar.
De cronjob probeert het maximaal vijf keer over een dag heen. Verlopen
abonnementen (HTTP 404 of 410) worden vanzelf opgeruimd — dat gebeurt bijvoorbeeld
als je de PWA verwijdert en opnieuw installeert.

## Een melding met de hand sturen

```sql
insert into notifications (kind, title, body, url, dedupe_key)
values ('sync_problem', 'Titel', 'Tekst', '/profiel', 'handmatig:2026-08-14');
```

Vanuit Python:

```python
from tm_sync import notify
notify.send(sb, kind="plan_ready", title="…", body="…", dedupe_key="…")
```
