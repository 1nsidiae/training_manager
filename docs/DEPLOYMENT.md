# Productiedeployment

De productie bestaat uit drie containers:

- `web`: Next.js PWA op poort 3000, alleen intern bereikbaar;
- `worker`: Garmin-sync, coach en workout-push;
- `caddy`: publieke HTTPS-ingang voor `training.jaspervanzeir.be`.

## Wie krijgt welk geheim

`compose.yaml` deelt bewust geen enkel `env_file` uit. Per container staat
uitgeschreven wat erin terechtkomt:

| | `web` | `worker` | `caddy` |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_*` | ✅ | — | — |
| `ANTHROPIC_API_KEY` | ✅ (coachchat) | ✅ (coach-engine) | — |
| `SUPABASE_SERVICE_ROLE_KEY` | — | ✅ | — |
| Garmin-tokens | — | ✅ (volume) | — |
| `DOMAIN`, `ACME_EMAIL` | — | — | ✅ |

De service-role key omzeilt alle RLS. Die hoort niet in de container die aan het
internet hangt, en staat daarom alleen bij de worker.

## Vereisten op de VPS

- Docker Engine met Compose-plugin;
- TCP-poorten 80 en 443 en UDP-poort 443 open;
- een DNS `A`-record voor `training.jaspervanzeir.be` naar het IPv4-adres van de VPS;
- optioneel een `AAAA`-record wanneer de VPS publiek IPv6 heeft.

## Eerste installatie

**Stap 1 — lokaal: Garmin-tokens genereren.** Doe dit op je eigen machine, niet
op de VPS: Garmins loginflow struikelt over datacenter-IP's.

```bash
uv run scripts/garmin_login.py
```

Dat schrijft `garmin_tokens.json` en `tm_login_stamp.json` in `~/.garminconnect`.
Die stempel legt vast wanneer je bent ingelogd; de worker telt daarvan af en
waarschuwt ruim voordat de tokens verlopen (zie *Tokenverval* hieronder).

**Stap 2 — op de VPS: uitchecken en invullen.**

```bash
git clone https://github.com/1nsidiae/training_manager.git
cd training_manager
cp .env.production.example .env.production
mkdir -p secrets/garminconnect
```

Vul `.env.production` in. Kopieer daarna beide bestanden uit `~/.garminconnect`
veilig naar `secrets/garminconnect/` op de VPS. Zet ze nooit in Git.

De worker draait als niet-root gebruiker met uid/gid `1000`. De `chown` in het
Dockerfile geldt alleen voor de image, niet voor deze bind-mount — die rechten
moet je op de host zetten, anders kan garth de ververste tokens niet wegschrijven:

```bash
sudo chown -R 1000:1000 secrets/garminconnect
sudo chmod 700 secrets/garminconnect
sudo chmod 600 secrets/garminconnect/*.json
```

**Stap 3 — Supabase.** Voeg onder **Authentication → URL Configuration**
`https://training.jaspervanzeir.be` toe als Site URL en toegestane Redirect URL.

**Stap 4 — starten.**

```bash
docker compose --env-file .env.production up -d --build
docker compose ps
```

Caddy vraagt automatisch een TLS-certificaat aan zodra DNS naar de VPS wijst en
de poorten bereikbaar zijn.

## Controleren dat het draait

Beide containers hebben een healthcheck, dus `docker compose ps` zegt meer dan
"up":

```bash
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
```

`web` is gezond zodra `/login` antwoordt. `worker` is gezond zolang de serve-lus
elke poll een hartslag wegschrijft. Dat onderscheid is er niet voor niets: een
worker die vastloopt zonder te crashen blijft anders gewoon "up" heten, terwijl
je sync stilstaat. Handmatig nakijken kan ook:

```bash
docker compose exec worker /app/.venv/bin/python -m tm_worker.health
```

## Tokenverval

De refresh-token van Garmin gaat ongeveer een half jaar mee en verraadt zijn
eigen einddatum niet — het is geen JWT, alleen een ondoorzichtige string. Daarom
telt de worker af vanaf `tm_login_stamp.json`:

- na **150 dagen** logt hij een waarschuwing en schrijft hij één keer per dag een
  rij in `sync_log` met `sync_type` `garmin_token_expiry:<datum>`;
- na **180 dagen** markeert die rij het als verlopen.

Herstellen is stap 1 opnieuw doen: lokaal inloggen, beide bestanden overzetten,
`docker compose restart worker`.

Zonder stempel zwijgt de controle. Dat is bewust: een verzonnen einddatum is
erger dan geen.

## Bijwerken

```bash
git pull --ff-only
docker compose --env-file .env.production up -d --build
docker image prune -f
```

`--build` is niet optioneel: een draaiende worker houdt de Python-code vast zoals
die bij het starten was. Zonder herbouw draait hij door met de oude versie.

## Herstel en diagnose

```bash
docker compose ps
docker compose logs --since=15m web
docker compose logs --since=15m worker
docker compose logs --since=15m caddy
```

De Supabase service-role key, Anthropic-key en Garmin-tokens horen uitsluitend
op de VPS te staan. Alleen de `NEXT_PUBLIC_`-waarden komen in de browserbundle
terecht.
