# Training Manager design system

Dit is het canonieke ontwerpcontract voor de PWA. De uitgebreidere merk- en
visuele achtergrond staat in [`../design-language.md`](../design-language.md),
maar nieuwe of aangepaste UI moet aan de regels in deze map voldoen.

## Karakter

De interface combineert Garmin-data en trainingsplanning in een compacte,
technische en rustige performance-UI. WHOOP is een referentie voor ritme en
hiërarchie; Garmin-benamingen en de eigen productidentiteit blijven leidend.

## Basisprincipes

1. **Data is de held.** Waarde, eenheid en periode komen vóór decoratie.
2. **Hiërarchie via surfaces.** Gebruik kleurverschil vóór extra randen,
   schaduwen of geneste kaarten.
3. **Kleur heeft betekenis.** Een accent identificeert een metriek, sport of
   evaluatie; het is geen versiering.
4. **Status en verandering zijn verschillend.** Een status mag een capsule
   zijn. Een numerieke verandering is altijd pijl + tekst zonder achtergrond.
5. **Progressive disclosure.** De pagina toont de kern; een Radix/Vaul drawer
   toont de volledige uitleg, trend en bron.
6. **Garmin-taal blijft behouden.** Gebruik bijvoorbeeld `Trainingsfitheid`,
   `HRV-status`, `Slaapscore` en `Training Load`; verzin geen WHOOP-metrieken.

## Verplichte primitives

- `Card` voor een hoofdmodule op `surface.1`.
- `.row` of `surface.2` voor compacte informatie binnen een module.
- `Badge` uitsluitend voor een status, bron, filter of compacte actie.
- `MetricDelta` voor elke stijging, daling of periodevergelijking.
- `Tabs`, `Drawer`, `Button`, `Progress` en andere bestaande shadcn/Radix
  primitives vóór een zelfgebouwd alternatief.

Lees vóór UI-werk ook:

- [`FOUNDATIONS.md`](FOUNDATIONS.md) voor tokens, spacing en typografie.
- [`COMPONENTS.md`](COMPONENTS.md) voor componentregels en voorbeelden.
- [`AUDIT.md`](AUDIT.md) voor de controlelijst en huidige auditbeslissingen.

## Definition of done voor UI

- Geen willekeurige hexkleur of radius wanneer een token bestaat.
- Geen rood/groen vergelijkingslabel met een gekleurde achtergrond of rand.
- Geen dubbele kaartlaag als een separator of `.row` hetzelfde verband toont.
- De volledige tappable module heeft minimaal een 44 px touch target.
- Hovergedrag staat alleen onder `(hover: hover) and (pointer: fine)`; touch
  gebruikt `:active`.
- Drawercontent heeft safe-area onderruimte en één verticale scroller.
- TypeScript en de productiebuild slagen.

