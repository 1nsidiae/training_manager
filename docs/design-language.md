# WHOOP-aligned Biometric Performance — Design Language

> De afdwingbare implementatieregels staan in
> [`design-system/README.md`](design-system/README.md). Dit document beschrijft
> de bredere visuele en merkcontext.

A reusable mobile design language derived from the supplied reference material and the official WHOOP Brand & Design Guidelines. It adopts the official color roles, typography hierarchy and data-presentation principles without using the WHOOP logo, implying affiliation, or renaming Garmin metrics as proprietary WHOOP scores.

## 1. Design principles

1. **Data is the hero** — Primary metrics are the largest element on screen. Decoration stays secondary.
2. **Dark, not flat black** — Use a layered near-black surface system to create hierarchy without heavy borders.
3. **Color has semantic meaning** — Accent colors communicate metric categories/status, never random decoration.
4. **One-glance comprehension** — Important values must be understandable in under 2 seconds.
5. **Progressive disclosure** — Overview first, deeper detail after tap.
6. **Rounded, compact modules** — Information lives in cards, pills, rows and circular/arc visualizations.
7. **Quiet motion** — Animations should feel measured and physical, not playful.

---

## 2. Color system

### Neutral foundation

- `bg.gradient.start`: `#283339`
- `bg.gradient.end`: `#101518`
- `surface.1`: `#182126`
- `surface.2`: `#222D33`
- `surface.3`: `#303B41`
- `border.subtle`: `rgba(255,255,255,0.08)`
- `border.strong`: `rgba(255,255,255,0.16)`

### Text

- `text.primary`: `#FFFFFF`
- `text.secondary`: `#B8C0C3`
- `text.tertiary`: `#7F898D`
- `text.disabled`: `#586267`

### Semantic metric accents

- `accent.teal`: `#00F19F` — calls to action, positive evaluations, Sleep Need
- `accent.strain`: `#0093E7` — activities and training-load data
- `accent.recovery`: `#67AEE6` — recovery-related data without evaluation
- `accent.sleep`: `#7BA1BB` — sleep-related data
- `accent.high`: `#16EC06` — evaluated recovery 67–100
- `accent.medium`: `#FFDE00` — evaluated recovery 34–66
- `accent.low`: `#FF0026` — evaluated recovery 0–33

> Accent colors should usually appear on dark surfaces at 70–100% opacity. Avoid large saturated backgrounds.

### Derived activity spectrum

Training types use a stable extension of the official cool accent spectrum.
These colors identify a workout category; readiness evaluation still uses the
official green/yellow/red scale together with a written status.

- `activity.walk-run`: `#7BA1BB`
- `activity.recovery`: `#67AEE6`
- `activity.easy`: `#0093E7`
- `activity.long`: `#00BDD6`
- `activity.tempo`: `#00F19F`
- `activity.interval`: `#A9E600`
- `activity.race`: `#FFDE00`
- `activity.strength`: `#FF6257`
- `activity.cross`: `#7F86FF`

Use the assigned color consistently for the type badge, schedule marker,
workout structure accent and compact week overview. Never rely on color alone.

---

## 3. Typography

The reference uses **Proxima Nova** for words and **DINPro Bold** for numerical data. This product uses the licensed open-source equivalents **Instrument Sans** for words and **Barlow Bold** for numerical data. Both are bundled locally so the interface never falls back to Arial. Do not fetch or redistribute unlicensed font files.

### Scale

- `display.metric`: 34–42 pt, Barlow Bold, tabular numerals
- `display.hero`: 28–34 pt, Instrument Sans Bold; uppercase only for a true hero headline
- `title.screen`: 20–24 pt, Instrument Sans Bold, compact tracking
- `title.card`: 13–17 pt, Instrument Sans Semibold, sentence case
- `body.primary`: 14–16 pt, Instrument Sans Medium
- `body.secondary`: 12–14 pt, Instrument Sans Medium
- `label`: 10–12 pt, Bold, uppercase, 10% tracking
- `micro`: 9–11 pt, Semibold

### Typography rules

- Large numeric values use tabular numerals where possible.
- Metric unit/label sits directly below or beside the value in a smaller size.
- Section labels are short and high contrast.
- Avoid huge marketing-style headings inside the data UI.

---

## 4. Spacing and layout

Use a **4 pt base grid**.

- Screen horizontal padding: `16 pt`
- Tight gaps: `4–8 pt`
- Component internal padding: `12–16 pt`
- Card gap: `8–12 pt`
- Section gap: `20–28 pt`
- Large vertical separation: `32 pt`

### Grid behavior

- Home/dashboard may use a 2-column card grid.
- Main biometric scores sit in 3 equal columns when space permits.
- Detail screens switch to a single vertical flow.
- Charts use full card width.

---

## 5. Shape language

- Main cards: radius `12–16 pt`
- Small cards/rows: radius `10–12 pt`
- Pills: radius `999 pt`
- Image cards: radius `14–18 pt`
- Floating circular actions: true circle

Borders are subtle. Prefer elevation through contrast between dark surfaces rather than shadows.

---

## 6. Core components

### A. Metric Ring

Used for Garmin Training Readiness, sleep duration, HRV or another clearly attributed headline metric. Do not rename those values to proprietary WHOOP scores.

Structure:
- Dark circular track
- Colored progress/arc
- Large center value
- Small center label below value
- Optional pointer/tick for gauge-style metrics

Rules:
- Ring stroke should be visually medium-heavy, approx. 4–6 pt.
- Empty track uses muted dark gray.
- Animate clockwise from 0 to current value on first reveal.
- Use only the official `#283339 → #101518` gradient for page backgrounds; metric arcs stay flat.

### B. Dashboard Metric Card

Compact card with:
- Primary value/title in top-left
- Small baseline/comparison value beneath
- Chevron in top-right
- Icon + metric name at bottom

Used in a 2-column grid.

### C. Summary Status Card

Example pattern: “Within range” or “Medium”.

Structure:
- Strong qualitative state as title
- Timestamp or summary as secondary line
- Small category icon/label below
- Chevron on right

### D. Metric List Row

Full-width rounded row for detail screens.

Structure:
- Circular or minimalist icon on left
- Main value + optional baseline
- Chevron on right
- 44–54 pt minimum row height

Rows have 6–8 pt vertical gaps between them.

### E. Insight Card

Outlined or raised dark card containing a short generated insight.

Structure:
- 2–4 lines of explanatory text
- Small CTA like “Explore insights →”
- Slightly stronger border than ordinary cards

### F. Segmented Duration Bar

Horizontal stacked bar showing categories such as low/medium/high stress.

- Rounded ends
- 3 semantic colors
- Numeric duration summary below
- Minimal labels

### G. Education / Session Image Card

Large photographic image card with dark lower gradient overlay.

Structure:
- Full-bleed image
- Title at lower-left
- Small category/subtitle under title
- Optional minimal icon near title

Cards are horizontally scrollable and partially reveal the next card.

### H. Bottom Navigation

- 4 evenly spaced destinations inside the main capsule
- Coach sits beside the capsule as a separate circular action
- Icons are line-based and thin
- Floating near-black capsule with a subtle border and restrained blur
- Active standard destinations use white icon/label contrast and a soft halo
- The Coach circle uses a recovery-blue ring and switches to teal when active
- Never imitate or place the WHOOP logo inside the circular action
- Standard destination labels stay visible so navigation never relies on icons alone
- Background is near-black with a very subtle top separator or blur
- Labels may be hidden or very small depending on density

### I. Floating Add Button

- White/light circular button
- Dark plus icon
- Floats above content, typically at the right edge of a section
- Strongest light element on the screen, therefore use sparingly

---

## 7. Charts and data visualization

### Line chart

- Dark card background
- Thin colored line
- Small hollow circular data points for selected/weekly summary chart
- Optional subtle area fill fading toward transparency
- Muted axis labels
- No heavy gridlines

### Live/continuous chart

- Thin data line
- Semantic color transitions are allowed when categories change
- Very subtle axes
- Current/selected point can be white

### Vertical bar chart

- Narrow bars with fully rounded caps
- Value printed above each bar
- Day/date beneath
- Use one semantic category color per metric

### Selection state

Selected day/value:
- Small dark pill/column highlight behind date
- White text for active item
- Other labels remain muted

---

## 8. Navigation pattern

### Home

1. Compact top bar with avatar/streak/day selector/device state
2. Three headline biometric rings
3. 2-column quick metrics
4. “My Day” / chronological feed
5. Persistent bottom navigation

### Metric detail

1. Back button + centered context/date + info button
2. Large hero ring/gauge
3. Supporting metric list or chart
4. Insight/explanation modules
5. Trend modules lower on page
6. Persistent bottom navigation

### Trends

- Large vertical scrolling report
- One chart/card per metric
- Week/date selector near top
- Charts have generous vertical breathing room

---

## 9. Motion language

Motion should communicate measurement and state.

### Timing

- Micro interaction: 120–180 ms
- Standard transition: 220–320 ms
- Metric reveal: 450–800 ms

### Easing

Use ease-out/spring with low bounce.

### Recommended animations

- Ring draws clockwise on load
- Number counts softly toward final value
- Chart line reveals left-to-right
- Cards fade + translate upward 6–12 pt
- Horizontal content carousels use native momentum and snapping
- Selected chart point gently scales/fades, not bounces

### Avoid

- Elastic/bouncy UI
- Strong parallax
- Large zoom transitions
- Decorative continuous animation

---

## 10. Iconography

- Thin monoline icons
- Approx. 1.5–2 pt stroke
- Rounded stroke caps
- Mostly monochrome white/gray
- Accent color only for active/semantic state
- Use simple recognizable symbols: heart, moon, activity, steps, stress, menu

On iOS, SF Symbols are an excellent fit.

---

## 11. Content language

Tone should be concise, analytical and calm.

Good:
- “91% Recovery”
- “Within range”
- “Medium”
- “43% of your time was spent in the low stress zone.”
- “See trends →”

Avoid:
- Long motivational slogans
- Excess exclamation marks
- Gamified cartoon language

---

## 12. Interaction principles

- Every card that opens details has a consistent chevron.
- Key metrics are tappable as a whole, not only the label.
- Horizontal carousels should reveal part of the next item.
- Dates/time ranges should be easily switchable without leaving the screen.
- Use haptics for selection, metric completion and primary action only.

---

## 13. Accessibility

- Do not encode state by color alone; pair color with text/value.
- Maintain at least 4.5:1 contrast for body text.
- Minimum touch target: 44×44 pt.
- Support Dynamic Type where possible.
- Charts must expose values to accessibility APIs.

---

## 14. Do / Don’t

### Do

- Keep the canvas almost black.
- Use slightly lighter dark cards for grouping.
- Let 1 metric dominate each module.
- Keep labels short.
- Use accent colors semantically.
- Show trends in simple, readable charts.
- Keep radius, spacing and row heights consistent.

### Don’t

- Add gradients outside the official background gradient.
- Use neon borders around every card.
- Put multiple loud colors in one component without data meaning.
- Use generic glassmorphism as the main visual style.
- Overload screens with decorative icons.
- Use giant empty spacing typical of marketing websites; this is a dense performance UI.

---

## 15. Master implementation prompt

Use the following prompt when generating new screens/components:

> Design a premium dark biometric performance interface using the “WHOOP-aligned Biometric Performance” design language. Use the official `#283339 → #101518` page gradient, charcoal rounded cards, white typography, Proxima Nova-style words and DINPro-style bold numerical data. Headlines are uppercase with 10% tracking. Apply exact semantic accents: teal `#00F19F` for actions and positive evaluations, strain blue `#0093E7` for activities, recovery blue `#67AEE6` for non-evaluated recovery data, sleep blue-gray `#7BA1BB` for sleep, and green/yellow/red `#16EC06` / `#FFDE00` / `#FF0026` for evaluated readiness states. Make numerical health metrics the visual hero. Use circular progress rings, compact metric cards, rounded list rows, minimal thin-line icons, and clean data charts with almost no gridlines. Use a 4pt spacing system, 16pt screen gutters, 12–16pt card radii, restrained borders and progressive disclosure. Do not use the WHOOP logo, claim affiliation, rename Garmin data to proprietary WHOOP scores, invent extra brand colors, or add gradients outside the official background gradient.

---

## 16. Suggested token object

```json
{
  "color": {
    "canvas": "#101518",
    "gradientStart": "#283339",
    "surface1": "#182126",
    "surface2": "#222D33",
    "surface3": "#303B41",
    "textPrimary": "#FFFFFF",
    "textSecondary": "#B8C0C3",
    "textTertiary": "#7F898D",
    "teal": "#00F19F",
    "strain": "#0093E7",
    "recovery": "#67AEE6",
    "sleep": "#7BA1BB",
    "high": "#16EC06",
    "medium": "#FFDE00",
    "low": "#FF0026"
  },
  "radius": {
    "small": 10,
    "medium": 12,
    "card": 16,
    "pill": 999
  },
  "spacing": [4, 8, 12, 16, 20, 24, 32],
  "motion": {
    "fast": 160,
    "standard": 260,
    "metricReveal": 650
  }
}
```

---

## 17. Visual identity summary

**Keywords:** dark, biometric, technical, athletic, calm, premium, modular, data-first, compact, semantic, precise.

A screen belongs to this design language when you can remove the logo and still recognize it from the near-black layered surfaces, semantic metric colors, circular hero metrics, compact rounded cards and restrained charts.
