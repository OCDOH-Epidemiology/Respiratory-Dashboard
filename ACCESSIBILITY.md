# Accessibility

## Conformance target

This dashboard targets **WCAG 2.1 Level AA**, the technical standard adopted by the U.S. Department of Justice's ADA Title II web rule (April 2024): <https://www.ada.gov/resources/2024-03-08-web-rule/>.

Last reviewed: October 8, 2026. axe-core 4.x reports **0 WCAG 2.0/2.1 A/AA violations** in light and dark color schemes at 1280px, 375px, and 320px wide, alongside manual code, keyboard, and contrast review.

## What was fixed (October 2026)

| Area | WCAG | Change |
| --- | --- | --- |
| Activity level text | 1.4.3 | Level word uses text-safe colors: Low `#007A3D` (5.45:1), Moderate `#8A5A00` (5.93:1), High `#B42318` (6.57:1). The bright dial and legend colors are unchanged. |
| Dark mode charts | 1.4.3, 1.4.11 | Chart.js text, gridlines, needle, bar value labels, vaccination fills, school line, and acute line are themed per `prefers-color-scheme` (e.g. axis text `#b6c2d2` 9.49:1, needle 14.66:1, vaccination fill `#5B8DEF` 5.30:1). Charts rebuild if the OS theme changes. |
| Focus indicator (dark) | 1.4.11, 2.4.7 | `--focus` becomes `#93B4FF` (8.33:1) in dark mode. |
| Chart text alternatives | 1.1.1, 1.3.1 | Every chart has a keyboard-operable **Show data table** disclosure with a captioned table of all values for the selected weeks (newest first). Chart summaries now include the range, latest value, and peak. |
| Chart instructions | 2.1.1, 3.3.2 | Removed the misleading "or focus a week" wording. Captions point to the data table. |
| ED line differentiation | 1.4.1 | COVID-19 solid line with circles, Flu dashed with triangles, RSV dotted with diamonds. The legend uses point shapes. |
| Selected toggle state | 1.4.11 | The selected segmented button has a 2px ring (`#004C7D`, 7.59:1 vs the track; light ring in dark mode). |
| Acute respiratory line | 1.4.11 | `#C2410C` (5.18:1) in light mode, `#E87722` (5.78:1) in dark mode. |
| Tooltips | 1.4.13 | **Escape** dismisses chart tooltips. They stay hidden until the pointer leaves the chart. |
| Week-range sliders | 4.1.2, 2.1.1 | Now `<div role="slider" tabindex="0">` (was an invalid `button role=slider`). Arrow keys, Page Up/Down (4 weeks), Home, End, and pointer drag all work. There is a larger invisible touch target. |
| Live regions | 4.1.3 | Removed duplicate and noisy live regions. One polite `#liveAnnouncer` reports range and vaccine changes. `#statusAlert` reports load status and switches to `role="alert"` on error. |
| Landmarks | 1.3.1, 2.4.1 | The H1, intro, status banner, and resource links are now inside `<main>`, so the skip link lands on the page title. |

Already in place: `lang="en"`, a descriptive title, skip link, landmarks and heading order, labelled toggles with `aria-pressed`, "(opens in a new tab)" link text, `prefers-reduced-motion` support, forced-colors support, and reflow at 320px.

Motion: the activity-dial needle sweep is short (under 1 second), runs once per page load when the dial first comes into view, and is skipped (needle placed directly) when `prefers-reduced-motion` is set.

## Recommended manual checks (before each release)

Automated tools cannot fully evaluate canvas charts or screen-reader output. Please spot-check:

1. **NVDA + Firefox/Chrome (Windows)** and **VoiceOver + Safari (macOS and iOS)**:
   - Skip link → focus lands in main, and the H1 is read.
   - The page load announces "Dashboard last updated…" once, without repeats.
   - Activity: "Low Level" and "Overall trend: Increasing" are read in order.
   - Each chart is read as an image with its title and summary (range, latest, peak).
   - "Show data table" announces expanded/collapsed. In table mode, row and column headers are read (Ctrl+Alt+arrows in NVDA, VO+arrows in VoiceOver).
   - Week sliders announce "Start week, slider, <date>" and update with arrow, Page Up/Down, Home, and End.
   - Switching "All available data" and the vaccine buttons announces one short message.
2. **Keyboard only**: Tab through everything. The focus ring should be visible in light and dark modes. Escape should close a chart tooltip.
3. **Zoom 200% / 400%** and **OS text size**: no lost content or horizontal page scroll.
4. **Windows High Contrast / forced colors**: dial, legend, sliders, and toggles remain visible.
5. **Data updates**: after editing `data/weekly.json` or the `ACTIVITY` override in `script.js`, confirm the activity color for Moderate and High levels.

## Not in scope

- **Language access (Spanish/LEP)** is a Title VI consideration separate from WCAG. The UI is English-only today.
- Third-party CDN assets (Bootstrap, Chart.js, Google Fonts, Lordicon, Google Analytics) are reviewed only as used on this page.

To report an accessibility problem, use the Orange County accessibility page: <https://www.orangecountygov.com/accessibility>.
