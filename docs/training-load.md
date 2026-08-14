# Multi-sport trainingsbelasting

De app houdt hardloopvolume en totale belasting bewust uit elkaar:

- alleen hardloopmeters sturen de opbouw van het loopschema;
- alle Garmin-activiteiten sturen herstel, weekreview en plaatsing van zware runs;
- een actief plan wordt nooit stil aangepast: de coach maakt eerst een voorstel.

## Bronvolgorde

Elke activiteit krijgt één uitlegbare bron, in deze volgorde:

1. Garmin `activityTrainingLoad` — gemeten, hoogste vertrouwen;
2. tijd per Garmin-hartslagzone — berekend, middelmatig vertrouwen;
3. duur × sportprofiel — expliciet als schatting getoond;
4. ontbrekend — telt niet als nulmeting of gemeten belasting.

De UI toont daarom ook `gemeten`, `gemeten + geschat`, `geschat op duur` of
`nog geen brondata`.

## Alle sporten blijven ondersteund

Bekende sporten worden in profielen gegroepeerd: lopen, fietsen, zwemmen,
wandelen, hiken, kracht, racketsporten (o.a. padel), teamsporten, roeien en
peddelen, wintersport en yoga/mobiliteit. Een nieuw of onbekend Garmin-type
valt altijd terug op `other`; het verdwijnt nooit uit activiteiten of belasting.

De oorspronkelijke Garmin-naam blijft in de activiteit zelf zichtbaar. Alleen
voor herstelberekening en samenvattingen wordt een canoniek profiel gebruikt.

## Beslisregels

- Acute belasting: laatste 7 dagen.
- Chronische belasting: gemiddelde weekbelasting over 28 dagen.
- Acute:chronische ratio verschijnt pas bij minimaal 50 chronische load, zodat
  een lege historie geen schijnprecisie geeft.
- Niet-loopbelasting uit de laatste 48 uur wordt apart gesplitst in aerobe en
  mechanische impact.
- `watch` vraagt extra herstelruimte; `protect` blokkeert in een nieuw voorstel
  een tempo-, interval-, race- of lange duurloop binnen 24–48 uur.

De gedeelde parameters staan in
[`tm_sync/training_load_model.json`](../tm_sync/training_load_model.json). Zowel
de Python coach/worker als de TypeScript PWA lezen hetzelfde model.
