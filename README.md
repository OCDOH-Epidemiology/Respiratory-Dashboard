# Respiratory Illness Dashboard

Orange County Department of Health public dashboard for county-level respiratory illness activity (flu, COVID-19, RSV).

## Run locally

Serve the folder over HTTP so `fetch('./data/weekly.json')` works (opening `index.html` as a file URL will fail to load data):

```bash
npx serve .
# or: python3 -m http.server 8080
```

Then open the printed local URL.

## Data file

All dial, trend, and chart values come from [`data/weekly.json`](data/weekly.json).

### Schema

```json
{
  "meta": {
    "lastUpdated": "YYYY-MM-DD",
    "lastUpdatedDisplay": "May 1, 2026",
    "seasonStart": "YYYY-MM-DD",
    "seasonEnd": "YYYY-MM-DD",
    "seasonLabel": "2026–27",
    "statusMessage": "Optional banner text",
    "notes": "Optional"
  },
  "activity": {
    "level": 1,
    "trend": 1
  },
  "vaccinations": {
    "asOf": "YYYY-MM-DD",
    "asOfDisplay": "October 7, 2026",
    "sourceUrl": "https://…",
    "demographicsUrl": "https://…",
    "covid": {
      "overallPercent": 1.3,
      "doses": 5460,
      "byAge": { "0-4": 0, "5–11": 0.1 },
      "byGender": { "Female": 1.4, "Male": 1.2 }
    },
    "flu": {
      "overallPercent": 5.2,
      "doses": 21564,
      "byAge": { "0-4": 3.6 },
      "byGender": { "Female": 5.8, "Male": 4.5 }
    }
  },
  "weeks": [
    {
      "weekEnding": "YYYY-MM-DD",
      "edCovid": 0.5,
      "edFlu": 1.2,
      "edRsv": 0.4,
      "schoolAbsenteeism": 2.1,
      "hospitalizations": null,
      "vaxCovid": null,
      "vaxFlu": null
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `activity.level` | `1` Low, `2` Moderate, `3` High |
| `activity.trend` | `1` Decreasing, `2` Staying the same, `3` Increasing |
| `meta.seasonStart` / `meta.seasonEnd` | Inclusive bounds for “Current season” on Trends charts (2026–27: Oct 3, 2026 – May 7, 2027). After `seasonEnd`, Trends defaults to “All available data” (completed season stays in the archive). |
| `weeks[].edCovid` / `edFlu` / `edRsv` | % of all ED visits for that pathogen (nullable) |
| `weeks[].edAcuteRespiratory` | Weekly acute respiratory ED visit count (nullable) |
| `weeks[].schoolAbsenteeism` | % of students absent among open schools (nullable; summer/closure weeks may be blank) |
| `weeks[].hospitalizations` | Reserved for Phase 2 |
| `weeks[].vaxCovid` / `vaxFlu` | Reserved for weekly series (unused; UI uses top-level `vaccinations`) |
| `vaccinations` | NYS coverage snapshot from the ESSS `Vaccinations` sheet |

Null series show an empty state (“Data coming soon”) instead of a broken chart.

## Updating ED visit data (ESSS)

Emergency department COVID, flu, and RSV percentages, plus acute respiratory visit counts, come from [`Respiratory Dashboard ESSS (Updated).xlsx`](Respiratory%20Dashboard%20ESSS%20(Updated).xlsx).

1. Add or edit weekly rows on the `All Visits`, `Acute Respiratory`, `COVID`, `Influenza`, and `RSV` sheets (Week label + disposition columns; charts use the `Total` column).
2. Update the `Vaccinations` sheet snapshot (overall NYS %, age, and gender blocks for COVID and flu) when new coverage figures are available.
3. Rebuild `data/weekly.json`:

```bash
python3 scripts/build_ed_from_esss.py
```

Percentages are `(pathogen Total ÷ All Visits Total) × 100`. Acute respiratory uses the `Acute Respiratory` sheet `Total` as a visit count. Weeks with `All Visits` total of 0 are stored as null (not plotted). School absenteeism and activity level fields are left unchanged. The same command also refreshes the top-level `vaccinations` object from the `Vaccinations` sheet.

Optional flags: `--xlsx path/to/file.xlsx` and `--json path/to/weekly.json`.

## Updating school absenteeism

Rebuild school rates from the School Masterlist (separate from ESSS):

```bash
python3 scripts/build_school_masterlist.py
```

## Phase 2 hooks

UI placeholder already exists on the page for:

1. **Hospitalizations** — wire a Chart.js series from `weeks[].hospitalizations` (or a nested structure if you need age/facility breakdowns). Add season/year scaling similar to the existing season toggle.

Vaccination coverage is live from `vaccinations` (Overall / Age / Gender, COVID and flu). Out of scope until feeds exist: predicted hospitalizations, wastewater maps, and separate pathogen dials.

## Stack

Static HTML, Bootstrap 5, Chart.js (CDN), custom CSS/JS. No build step.
