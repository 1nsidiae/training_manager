# Design audit

Laatst bijgewerkt: 14 augustus 2026.

## Beslissingen uit de audit

- De bestaande surface ladder blijft behouden; `surface.2` is bewust lichter
  voor vergelijkingen en compacte KPI-tegels.
- De rood/groen gevulde vergelijkingslabels zijn vervangen door de gedeelde
  `MetricDelta` zonder achtergrond of rand.
- Biometrische vergelijkingen, gezondheids-KPI's en Trainingsbelasting delen
  hetzelfde deltapatroon.
- Statusbadges blijven bestaan voor echte categorische statussen en bronnen.
- Hoofdpagina's gebruiken één sectieritme van 20 px (`space-y-5`).
- `Card`, `Tabs` en `Drawer` blijven de enige basisprimitives voor die patronen.

## Controlelijst per scherm

- [ ] Komt de dominante waarde vóór uitleg en decoratie?
- [ ] Zijn hoofdcard en geneste surface duidelijk maar rustig verschillend?
- [ ] Is elke cijfermatige vergelijking een `MetricDelta`?
- [ ] Is elke `Badge` werkelijk een status, bron, filter of actie?
- [ ] Gebruikt de pagina `space-y-5` voor hoofdsecties?
- [ ] Gebruiken tabs, buttons en drawers de gedeelde primitives?
- [ ] Zijn Garmin-namen en databron zichtbaar?
- [ ] Zijn ontbrekende data expliciet en niet als nul voorgesteld?
- [ ] Werken touch, keyboardfocus, reduced motion en safe areas?

## Toegestane uitzonderingen

- Gekleurde icon-cirkels mogen een categorie snel herkenbaar maken.
- Een alertsurface mag rood/geel/groen getint zijn als actie of veiligheid de
  reden is, niet puur omdat een getal veranderde.
- Kaarten, chart-area-fills en de appachtergrond mogen hun eigen technische
  rendering gebruiken; tekst- en componenthiërarchie blijft hetzelfde.

