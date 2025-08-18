// Upgrade tenants_demo_for_tagging.csv from 11-col schema to extended schema
// Adds columns: id,name,canonicalName,building,floor,country,amenity,primary,secondary,
//               tertiary (pipe-separated),floorspace,rentPerSqFt,monthlyRent,annualRent,
//               leaseYears,leaseStart,leaseEnd,salesMonthly,membershipsMonthly,visitsDaily
// Also injects sample time-series for a few known tenants to validate charts.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'public', 'data');
const SRC_FILE = path.join(DATA_DIR, 'tenants_demo_for_tagging.csv');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

function canonicalize(name) {
  return String(name || '')
    .replace(/\[.*?\]/g, '')
    .replace(/\b(limited|ltd|co\.?|company)\b/gi, '')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase();
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result.map((s) => s.trim());
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes(';') || s.includes(':')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function generateMonthlySeries(pairs) {
  // pairs: [ ['2024-01', 100], ... ]
  return pairs.map(([m, v]) => `${m}:${v}`).join(';');
}

function generateDailySeries(pairs) {
  // pairs: [ ['2024-06-01', 100], ... ]
  return pairs.map(([d, v]) => `${d}:${v}`).join(';');
}

function getSampleTimeSeries(name) {
  const n = String(name || '').toLowerCase();
  const out = { salesMonthly: '', membershipsMonthly: '', visitsDaily: '' };

  // Gyms / fitness memberships
  if (n.includes('pure fitness') || n.includes('go24') || n.includes('yoga')) {
    out.membershipsMonthly = generateMonthlySeries([
      ['2024-01', 1200], ['2024-02', 1180], ['2024-03', 1225], ['2024-04', 1250],
      ['2024-05', 1300], ['2024-06', 1325], ['2024-07', 1350], ['2024-08', 1375],
      ['2024-09', 1390], ['2024-10', 1410], ['2024-11', 1430], ['2024-12', 1450],
    ]);
  }

  // F&B daily visits and/or monthly sales
  if (n.includes('pret a manger') || n.includes('saladstop') || n.includes('sixteenth') || n.includes('fineprint') || n.includes('ask for alonzo')) {
    out.visitsDaily = generateDailySeries([
      ['2024-06-01', 520], ['2024-06-02', 480], ['2024-06-03', 610], ['2024-06-04', 630], ['2024-06-05', 640],
      ['2024-06-06', 650], ['2024-06-07', 900], ['2024-06-08', 950], ['2024-06-09', 870], ['2024-06-10', 620],
      ['2024-06-11', 610], ['2024-06-12', 615], ['2024-06-13', 640], ['2024-06-14', 880], ['2024-06-15', 930],
    ]);
    out.salesMonthly = generateMonthlySeries([
      ['2024-01', 280000], ['2024-02', 260000], ['2024-03', 300000], ['2024-04', 310000], ['2024-05', 325000], ['2024-06', 340000],
    ]);
  }

  // Co-working / third space memberships
  if (n.includes('blueprint') || n.includes('the refinery') || n.includes('the great room') || n.includes('the executive centre')) {
    out.membershipsMonthly = generateMonthlySeries([
      ['2024-01', 220], ['2024-02', 215], ['2024-03', 225], ['2024-04', 230], ['2024-05', 240], ['2024-06', 245],
      ['2024-07', 255], ['2024-08', 260], ['2024-09', 265], ['2024-10', 270], ['2024-11', 275], ['2024-12', 280],
    ]);
  }

  return out;
}

function run() {
  if (!fs.existsSync(SRC_FILE)) {
    console.error(`CSV not found: ${SRC_FILE}`);
    process.exit(1);
  }
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `tenants_demo_for_tagging.csv.upgrade-${ts}.bak`);
  fs.copyFileSync(SRC_FILE, backupPath);

  const raw = fs.readFileSync(SRC_FILE, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim() !== '');
  if (lines.length < 2) {
    console.error('CSV appears empty');
    process.exit(1);
  }
  const header = parseCSVLine(lines[0]);
  const isShort = header.length === 11 && header[0].toLowerCase() === 'name';
  if (!isShort) {
    console.log('CSV already appears to be extended or non-standard; no change made.');
    return;
  }

  const outHeaders = [
    'id',
    'name',
    'canonicalName',
    'building',
    'floor',
    'country',
    'amenity',
    'primary',
    'secondary',
    'tertiary (pipe-separated)',
    'floorspace',
    'rentPerSqFt',
    'monthlyRent',
    'annualRent',
    'leaseYears',
    'leaseStart',
    'leaseEnd',
    'salesMonthly',
    'membershipsMonthly',
    'visitsDaily',
  ];

  const outLines = [outHeaders.join(',')];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    if (row.length < 11) continue;
    const [name, building, floor, amenity, primary, secondary, tertiary, floorspace, rentPerSqFt, monthlyRent, annualRent] = row;
    const cn = canonicalize(name);
    const samples = getSampleTimeSeries(name);
    const outRow = [
      '', // id
      name,
      cn,
      building,
      floor,
      '', // country
      amenity,
      primary,
      secondary,
      tertiary,
      floorspace,
      rentPerSqFt,
      monthlyRent,
      annualRent,
      '', // leaseYears
      '', // leaseStart
      '', // leaseEnd
      samples.salesMonthly,
      samples.membershipsMonthly,
      samples.visitsDaily,
    ];
    outLines.push(outRow.map(csvEscape).join(','));
  }

  fs.writeFileSync(SRC_FILE, outLines.join('\n'), 'utf8');
  console.log(`Upgraded CSV written: ${SRC_FILE}`);
  console.log(`Backup created at: ${backupPath}`);
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exit(1);
}


