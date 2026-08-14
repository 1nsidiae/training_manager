# Component contract

## Badge versus MetricDelta

Dit onderscheid geldt in de hele app.

### `Badge`

Gebruik voor een categorische toestand die de gebruiker kan benoemen:

- `ACTIEF`, `TE KORT`, `OP GARMIN`;
- bronlabel zoals `GARMIN`;
- trainingscategorie of filter;
- compacte workflowstatus zoals `WACHT OP JOU`.

Een statusbadge is terughoudend. Een neutrale outline is de standaard. Een
semantische tint mag alleen als de status zelf aandacht of actie vraagt.

### `MetricDelta`

Gebruik voor iedere vergelijking of verandering:

- `↓ −0,4 u`;
- `↑ +24 ms`;
- `+9% vs vorige week`;
- `gelijk aan vorige 7 dagen`.

Een delta heeft **nooit** een capsule, achtergrond of rand. Gebruik alleen een
richting-icoon en semantisch gekleurde tekst. De richting en evaluatie zijn
aparte gegevens: een dalende rusthartslag kan positief zijn, een dalende
slaapduur negatief.

## Cards en rows

- Eén `Card` groepeert één onderwerp.
- Kleine vergelijkingen binnen die card gebruiken losse `.row`-tegels op de
  lichtere `surface.2`.
- Gebruik separators voor sterk verwante tabelregels.
- Vermijd een card in een card als de binnenste laag geen eigen actie of
  betekenis heeft.
- Pressable cards gebruiken `surface-pressable` en een duidelijke chevron.

## Metricdetail

Volg deze volgorde:

1. titel, Garmin-bron en meetdatum;
2. dominante actuele waarde of ring;
3. gedeelde Tabs;
4. geselecteerde periode en interactieve grafiek;
5. lichtere vergelijkingstegels;
6. uitleg en datakwaliteitsnotitie.

Grafieken gebruiken de kleur van de metriek. Een groene/rode delta boven een
grafiek blijft losse tekst. Ontbrekende dagen maken een onderbreking en worden
niet als nul getekend.

### Slaapfasen

- Gebruik een compact verbonden faseverloop, geen hoge gevulde kolommen vanaf
  een gezamenlijke onderlijn.
- Gebruik alleen de bestaande neutral/sleep/recovery-kleuren; Garmin-paars en
  roze worden niet gekopieerd.
- Houd één rustige tijdas en toon de exacte fase en duur na een tik.
- De faseverdeling gebruikt `surface.2`-tegels en een compacte gestapelde balk.

## Tabs

- Altijd `Tabs`, `TabsList`, `TabsTrigger` uit `components/ui/tabs`.
- 44 px hoog, gelijke segmenten en één actieve `surface.3`.
- Iconen maximaal 16 px.
- Geen lokale afwijkende padding tenzij een expliciete compacte variant wordt
  toegevoegd aan de gedeelde primitive.

## Drawers

- Gebruik de gedeelde Vaul `Drawer`.
- Header en drag handle blijven zichtbaar; de content heeft één scroller.
- Omlaag swipen sluit wanneer de content bovenaan staat; omhoog scrollt.
- Klik op de overlay sluit.
- Geen zwevende footer boven ongelezen content; reserveer safe-area padding.

## Alerts en inzichten

Een fout, veiligheidswaarschuwing of bevestiging mag een subtiele gekleurde
surface gebruiken omdat het een toestand is die actie vraagt. Gewone
vergelijkingen, gemiddelden en informatieve labels mogen dat niet.
