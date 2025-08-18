# Tenant Portfolio Dashboard

An interactive tenant analytics dashboard for Management Offices. It runs entirely in the browser (no backend), loads a JSON dataset, and provides filters, KPIs, charts and CSV export. This document is written for an IT audience with no prior context on the project.

## Quick start

Prerequisites:
- Node.js 18+ and npm 9+ (repo sets `packageManager: npm@10`)

Local run:
```bash
npm install
npm run dev
```
Then open the URL printed by the dev server (typically http://localhost:5173).

Optional: Build a static production bundle:
```bash
npm run build
npm run preview
```

## What the dashboard does

- Ingests a tenant dataset (JSON; optionally maintained via CSV) with identity, location, area, rent, tags, country of origin, and optional time-series.
- Provides filters: search, location, floor, country, and taxonomy tags (Primary = Land Use, Secondary, Tertiary).
- Computes KPIs and renders charts (bar, line, pie) across metrics: Space, Rent, Count, plus Sales/Engagement if available.
- Exports the filtered or selected slice to CSV with configurable columns, including time-series rollups.

## How data loads

On page load the app attempts to fetch:
1. `public/data/tenants_demo.json` (default demo dataset), else
2. `public/data/tenants_master.json` (if you’ve built from Excel), else
3. The user can upload a JSON or CSV file from the UI; it will be used for that session only.

Supporting file: `public/data/building_stats.json` (optional) is used to compute occupancy per building (total and vacant area). If absent, occupancy KPIs fall back gracefully.

## Data model (per-tenant)

Core fields used by the UI:
- id: number (stable identifier)
- name: string (display name)
- canonicalName: string (uppercase alphanumeric form used for grouping related entities)
- location: string (building code/name)
- floor: string (e.g., "25/F", supports multiple or ranges in CSV; expanded internally)
- country: string (country of origin)
- landUse: 'Office (Land Use)' | 'Retail (Land Use)'
- tags: string[] (contains landUse and optional secondary/tertiary and 'Amenity')
- floorspace: number (square feet)
- rentPerSqFt: number
- monthlyRent: number
- annualRent: number
- leaseYears, leaseStart, leaseEnd: optional
- occupancyRate: optional number (percent)

Optional time-series fields (if provided they unlock Sales/Engagement charts and export):
- salesMonthly: [{ month: 'YYYY-MM', sales: number }]
- salesByYear: [{ year: 'YYYY', sales: number }]
- membershipsMonthly: [{ month: 'YYYY-MM', members: number }]
- visitsDaily: [{ date: 'YYYY-MM-DD', visits: number }] (aggregated to monthly/yearly in the UI)

## CSV schema (for authoring and sync)

Two CSV schemas are supported by tooling. The app itself consumes JSON, but you can maintain data in CSV and sync to JSON.

Extended (recommended; stable ids and grouping):
```
id,name,canonicalName,building,floor,country,amenity,primary,secondary,tertiary (pipe-separated),floorspace,rentPerSqFt,monthlyRent,annualRent,leaseYears,leaseStart,leaseEnd,salesMonthly,membershipsMonthly,visitsDaily
```

Short (legacy/simple):
```
name,building,floor,amenity,primary,secondary,tertiary (pipe-separated),floorspace,rentPerSqFt,monthlyRent,annualRent
```

Key rules used by the sync tool when transforming CSV -> JSON:
- amenity: Y/Yes/True/1/X marks the record as an Amenity (adds 'Amenity' to tags).
- primary: 'Office' or 'Retail' and is normalized to 'Office (Land Use)' or 'Retail (Land Use)'.
- secondary/tertiary: taxonomy tags; 'tertiary (pipe-separated)' accepts multiple values joined by '|'.
- floor: supports lists and ranges (e.g., "25/F-27/F", "25-27", "G", "B2"); ranges are expanded to one row per floor.
- country: should be provided in CSV; a helper exists to populate missing values using a weighted distribution.
- time-series fields (if used):
  - salesMonthly: "YYYY-MM:value;YYYY-MM:value"
  - membershipsMonthly: "YYYY-MM:value;..."
  - visitsDaily: "YYYY-MM-DD:value;..." (UI auto-aggregates to month/year)
- Grouping key: the app uses `canonicalName` plus `location` and `floor` to identify the same brand/tenant across rows; `canonicalName` defaults to a cleaned uppercase variant of `name` if not provided.

## Using the dashboard (operator guide)

Filters and selectors:
- Tenant search: free-text search with fuzzy matching.
- Location filter: select one or more buildings.
- Floor filter: select one or more normalized floor tokens.
- Country filter: select countries directly or via region shortcuts.
- Tags: pick any mix of Primary (Land Use), Secondary, and Tertiary tags. Tag logic is OR (tenants matching any selected tag are included). The tag dictionary is dynamic, so any new tags present in your CSV appear automatically.
- Tenant selection: click rows to select tenants; charts can operate on Selected-only vs the entire filtered set.

Metrics and views:
- Metric: Space, Rent, or Count.
- Rent period: Monthly vs Annual.
- Value mode: Absolute vs Share (percent within the slice).
- Views: Individual brands or Grouped by tag.
- Sales and Engagement tabs: appear if the dataset includes the corresponding time-series fields.

CSV export (from the Export button):
- Scope: export current Filtered tenants or only Selected tenants.
- Columns: configurable groups for Identity/Location, Space, Rent/Lease/Occupancy, Tags, and Sales rollups:
  - Identity/Location: id, name, location, floor, country, landUse
  - Space: floorspace
  - Rent/Lease: rentPerSqFt, monthlyRent, annualRent, occupancyRate, leaseYears, leaseStart, leaseEnd
  - Tags: tags array
  - Sales: monthly series per month, yearly series per year, latest month, last-12-months total, rent-to-sales ratios

## Repository layout

- `src/` – React + TypeScript application
  - `src/App.tsx` – all UI, filters, charts, export modal
  - `src/main.tsx`, `src/index.css` – app init and styles (Tailwind)
- `public/data/` – datasets and outputs used by the app
  - `tenants_demo.json` – primary dataset used by default
  - `tenants_demo_for_tagging.csv` – CSV representation for authoring/edits
  - `tenants_master.json` – built from Excel (see tools)
  - `tenants_master_for_tagging.csv` – CSV export of the master
  - `building_stats.json` – optional building totals for occupancy
- `tools/` – Node.js scripts (run with `node ...` or via npm scripts)

## Tooling (data build/sync/validate)

Common commands:
- `npm run build:synthetic` – generate a balanced synthetic demo at `public/data/tenants_demo.json`.
- `npm run build:data` – build `tenants_master.json` from a local Excel at `data-sources/Tenant list to upload to Cursor.xlsx` (not committed); also writes `building_stats.json`.
- `npm run build:demo` – derive `tenants_demo.json` and `tenants_demo_for_tagging.csv` from the master, optionally enriched by a local Amenity workbook.
- `npm run sync:csv` – apply edits in `tenants_demo_for_tagging.csv` back into `tenants_demo.json`. Handles schema differences, floor expansion, and upserts by id or composite key.
- `npm run watch:csv` – like sync above, but watches the CSV and re-syncs on save.
- `npm run populate:countries` – fill missing CSV `country` values using a weighted distribution; creates a timestamped backup.
- `npm run validate:csv` – lint the CSV for likely missing fields (e.g., Sales expected for F&B/Retail and Engagement expected for Fitness/Third Space).
- `npm run export:demo:csv` – export the current demo JSON to a CSV.
- `npm run backup:demo` – snapshot dataset backups under `public/data/backups`.
- `npm run consolidate:data` – validate → backup → sync from CSV to JSON.

Other utilities exist for data hygiene (e.g., split multi-floor entries, fix floor tokens, enrich time-series) and are self-documented at the top of each script in `tools/`.

Notes about confidential sources:
- The `data-sources/` folder is intentionally not committed. Place workbooks locally when rebuilding; never commit source files.

## Deployment

The app is a static site (Vite + React). It can be hosted from any subpath (GitHub Pages, S3, internal web servers). The Vite config sets `base: './'` so all asset URLs are relative.

Optional GitHub Pages flow:
```bash
npm run build
npm run deploy
```
This publishes the `dist/` folder to GitHub Pages using `gh-pages`.


## Technology stack

- React 19, TypeScript, Vite 7
- Tailwind CSS 4 for styling
- Recharts for charting
- Fuse.js for fuzzy search
- Node.js scripts (ES modules) for data build/sync

## Troubleshooting

- Blank page or dataset not found: ensure `public/data/tenants_demo.json` exists, or upload a file via the UI.
- Occupancy shows zero or N/A: add `public/data/building_stats.json` (generated by `npm run build:data`).
- CSV sync fails on commas in `floor`: the sync tool recovers most cases; ensure multi-token floor values are quoted in CSV.
- Countries missing in charts: run `npm run populate:countries` to fill empty `country` fields in CSV, then `npm run sync:csv`.
- Time-series charts empty: provide `salesMonthly`, `membershipsMonthly`, or `visitsDaily` in CSV (see formats above) and re-sync.
- Hosting under a subpath: Vite is configured with relative base; ensure you deploy the built `dist/` as-is.

## Security & privacy

- No backend or external APIs are used; all processing happens in the browser.
- Source workbooks and sensitive inputs live outside the repo in `data-sources/` and must not be committed.

---

For questions during the demo: the main entry point is `src/App.tsx`. The app is intentionally self-contained to simplify onboarding for reviewers.
