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
- Een gewone actiekaart gebruikt de standaard `border-line`. Een sterkere rand
  is alleen voor een geselecteerde/open toestand of een echte waarschuwing.

## Hoofdpagina-header

- Vandaag, Plan, Activiteiten, Coach en Profiel gebruiken bovenaan dezelfde
  compacte `AppTopBar`: profiel links, korte paginacontext exact gecentreerd en
  rechts een even breed actiegebied.
- Vandaag mag in het midden de datumkiezer en rechts de synchronisatiestatus
  tonen, maar behoudt exact dezelfde kolommen, avatarmaat en minimale hoogte.
- Onder de appbar staat de inhoudelijke `ScreenHeader`: een eyebrow, een unieke
  paginatitel, eventueel een korte omschrijving en maximaal één status of actie.
- Herhaal niet hetzelfde woord in appbar en H1. Gebruik bijvoorbeeld
  `Activiteiten` met `Trainingshistorie`, en `Coach` met `Vraag je coach`.
- Hoofdlabels zijn kort en rustig. Navigatiecontext is geen tweede hero en krijgt
  daarom nooit dezelfde typografische nadruk als de H1.

## Trainingsblok en planningskalender

- Tijdens het slepen volgt de kalenderhoogte continu de vinger en vloeien week-
  en maandweergave in elkaar over. Pas na loslaten klikt de kalender rustig naar
  de dichtstbijzijnde eindstand; een tik op header of handle blijft een sneltoets.

- Blokvoortgang gebruikt één horizontaal segment per week. Dit blijft compact
  bij zowel vier als zestien weken; voltooid, huidig en gepland zijn visueel
  onderscheiden zonder grote heatmap.
- Bovenaan de planpagina staat één inklapbare weekkalender. De compacte stand
  toont de huidige week; een tik of neerwaartse trek aan de handle opent de
  volledige maand.
- Iedere sessie gebruikt in de kalender de vaste kleur uit `SESSION_META`.
  Meerdere sessies op één dag krijgen meerdere markers en na een tik volgt een
  tekstuele lijst met type en status.
- Een jaarheatmap hoort bij Activiteiten/Trends en niet in de doelkaart.

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
- Keyboardfocus gebruikt een subtiele accentkleur binnen het segment. Op touch
  verschijnt geen blijvende witte focusrand.

## Taal en systeemdata

- Toon nooit databasekeys, snake_case-regelcodes of modelvelden in de interface.
- Vertaal technische regels naar korte, concrete Nederlandse labels; de
  onderliggende uitleg mag daarna volledig en inhoudelijk blijven.

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

## Toasts en tijdelijke feedback

- Gebruik de gedeelde Sonner `Toaster` en importeer `toast` uit
  `components/ui/sonner`.
- Een resultaat van een gebruikersactie verschijnt als toast: opslaan,
  synchroniseren, testen, in- of uitschakelen en een mislukte aanvraag.
- Gebruik `success`, `info`, `warning` of `error`; kleur zit in het icoon, niet
  in een grote gekleurde achtergrond of capsule.
- Zet korte actie-uitkomst in de titel en noodzakelijke context in de
  beschrijving. Geen technische prefix zoals `Error:` of `Mislukt:` in gewone
  lopende tekst.
- Toon dezelfde tijdelijke melding niet ook nog inline. Permanente toestand,
  validatie naast een specifiek veld en uitleg die nodig blijft, horen wel in
  de pagina of card.
- Fouten blijven langer zichtbaar dan succesmeldingen. De globale toaster
  bewaakt iOS-safe-area, positie, radius, typografie en swipegedrag.

## Wekelijkse review

- De review gebruikt geen zelfbedachte totaalscore. Hij toont afzonderlijk
  uitvoering, ervaren belasting en herstelcontext, telkens met de brondata.
- Alle Garmin-sporten tellen mee als trainingscontext. Alleen gelopen kilometers
  worden rechtstreeks met het hardloopplan vergeleken.
- Tijdens de week is de review expliciet voorlopig; de automatische
  zondagsreview sluit de week af zodra de worker draait.
- De compacte card toont alleen besluit, periode en kerncijfers. Onderbouwing
  en datakwaliteit staan in een `DetailDrawer` via progressive disclosure.
- Gebruik semantische kleur alleen voor het besluit. Vergelijkingswaarden en
  bewijs blijven neutraal zodat de hiërarchie rustig blijft.
- Een review mag nooit stilzwijgend het actieve plan wijzigen. Een aanpassing
  verschijnt als afzonderlijk voorstel en wordt pas na goedkeuring toegepast.
