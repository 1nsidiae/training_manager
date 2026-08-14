# Foundations

## Surface ladder

| Rol | Token | Gebruik |
| --- | --- | --- |
| Canvas | `canvas` / `base` | Appachtergrond en statusbar-overgang |
| Surface 1 | `bg-s1` | Hoofdcard, drawer, navigatiecapsule |
| Surface 2 | `bg-s2` / `.row` | KPI-tegel, vergelijking, rij in een card |
| Surface 3 | `bg-s3` | Actieve tab, input en tijdelijke selectie |

Gebruik `border-line` als subtiele begrenzing en `border-line-strong` alleen
voor een interactief of belangrijk inzicht. Gekleurde randen zijn niet bedoeld
om een numerieke verandering te tonen.

## Tekst

- `text-ink`: primaire titel of actuele waarde.
- `text-muted`: uitleg en secundaire labels.
- `text-faint`: metadata, assen en microcopy.
- `text-off`: disabled of ontbrekende data.
- `.numeral`: belangrijke cijfers en tabulaire meetwaarden.
- `.label`: korte sectielabels, uppercase.
- `.micro`: metadata en ondersteunende context.

Instrument Sans is het UI-lettertype; Barlow is voor dominante cijfers. Een
schermtitel gebruikt sentence case, behalve waar een bestaande Garmin-term of
compacte sectiehiërarchie uppercase vereist.

## Spacing

Werk op een 4 px grid.

- Schermgutter: 16 px.
- Interne cardpadding: 12–16 px.
- Rij- of compacte cardgap: 8 px.
- Hoofdsecties: 20 px (`space-y-5`).
- Draweronderruimte: de gedeelde drawer/safe-area-regel, niet lokaal gokken.

Alle hoofdpagina's gebruiken `space-y-5`. Een grotere afstand is alleen
toegestaan voor een bewuste lege staat of een marketingachtig onboardingblok.

## Radius

- `.row`: `--radius-row` (12 px).
- `Card`: `--radius-card` (18 px).
- Tabs en velden: 12 px.
- Capsules: alleen badges, filters en echte pill-actions.
- Coachactie: zelfde radiusfamilie als de navigatie, visueel apart geplaatst.

## Semantische kleuren

- Teal: positieve evaluatie of primaire actie.
- Strain blue: activiteit en trainingsbelasting.
- Recovery blue: hersteldata zonder positieve/negatieve evaluatie.
- Sleep blue-gray: slaapdata.
- Geel: aandacht of gematigde trainingsfitheid.
- Rood: negatieve evaluatie of veiligheidswaarschuwing.
- Sportkleuren: alleen om trainingscategorieën consequent te onderscheiden.

Kleur staat nooit alleen: voeg altijd tekst, richting, icoon of categorie toe.

