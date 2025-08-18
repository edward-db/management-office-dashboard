# Tenant Portfolio Dashboard (What each folder/file is for)

This app shows a dashboard of tenants with filters and charts.

Run locally:

```bash
npm install
npm run dev
```

## Folders

- `src/`: The application code
  - `src/App.tsx`: The dashboard UI and all logic (filters, charts)
  - `src/main.tsx`: App startup
  - `src/index.css`: Tailwind CSS import
- `public/`: Static files served as-is
  - `public/data/`: Datasets the app can preload
    - `tenants_demo.json`: Demo dataset used by default
    - `tenants_demo_for_tagging.csv`: Same data as CSV for easy editing
    - `tenants_master.json`: Full dataset built from your Excel
    - `tenants_master_for_tagging.csv`: Full dataset as CSV
    - `building_stats.json`: Building totals used for occupancy calcs
- `tools/`: Data build utilities (run with Node)
  - `build-tenants-from-xlsx.mjs`: Build `tenants_master.json` from your Excel
  - `build-demo-dataset.mjs`: Derive `tenants_demo.json` from master + amenity mapping
  - `sync-csv-to-demo.mjs`: Apply CSV edits back to `tenants_demo.json`
  - `build-synthetic-demo.mjs`: Generate a synthetic demo dataset
Note on confidential inputs:
- The `data-sources/` directory (Excel workbooks) has been removed from the repo and is ignored. Use `npm run build:synthetic` for demo data, or place your own private workbooks locally (never commit) and run tooling manually if needed.

## Commands

- `npm run dev`: Start the app
- `npm run build`: Build for production
- `npm run build:demo`: Build `tenants_demo.json` + CSV from `tenants_master.json` if available; otherwise relies on heuristics only
- `npm run sync:csv`: Sync edits from `tenants_demo_for_tagging.csv` into `tenants_demo.json`
- `npm run build:synthetic`: Generate a synthetic demo dataset

## How data loads in the app

On start, `index.html` tries to preload `public/data/tenants_demo.json`. If not found, it tries `tenants_master.json`. The component then reads the preloaded JSON. If you upload a file in the UI, it will use that for the session.
