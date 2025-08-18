// Enrich tenants_demo_for_tagging.csv with sample time-series where empty
// Only modifies rows with empty salesMonthly/membershipsMonthly/visitsDaily

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'public', 'data');
const CSV_FILE = path.join(DATA_DIR, 'tenants_demo_for_tagging.csv');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function monthly(pairs) { return pairs.map(([m, v]) => `${m}:${v}`).join(';'); }
function daily(pairs) { return pairs.map(([d, v]) => `${d}:${v}`).join(';'); }

function inferCategory(row, idx) {
  const get = (k) => row[idx[k]] ?? '';
  const name = get('name').toLowerCase();
  const primary = (get('primary') || '').toLowerCase();
  const secondary = (get('secondary') || '').toLowerCase();
  const tert = (get('tertiary (pipe-separated)') || '').toLowerCase();
  const tags = `${primary} ${secondary} ${tert}`;
  const amenity = (get('amenity') || '').toLowerCase();

  const isFitness = /fitness|gym|yoga/.test(tags) || /pure fitness|go24|yoga/.test(name);
  const isFB = /f&b|restaurant|cafe|caf\u00E9|grab and go|bakery|food hall/.test(tags) || /pret|saladstop|sixteenth|fineprint|alonzo|omusubi|heybo|lady m|akiyoshi|forbidden duck|fuel espresso|little cove/.test(name);
  const isThirdSpace = /co-working|third space|member's club|member|club/.test(tags) || /blueprint|refinery|executive centre|great room/.test(name);
  return { isFitness, isFB, isThirdSpace, amenity: ['y','yes','x','true','1'].includes(amenity) };
}

function makeFitnessMembers() {
  return monthly([
    ['2024-01', 1200], ['2024-02', 1180], ['2024-03', 1225], ['2024-04', 1250],
    ['2024-05', 1300], ['2024-06', 1325], ['2024-07', 1350], ['2024-08', 1375],
    ['2024-09', 1390], ['2024-10', 1410], ['2024-11', 1430], ['2024-12', 1450],
  ]);
}

function makeFBVisits() {
  return daily([
    ['2024-06-01', 520], ['2024-06-02', 480], ['2024-06-03', 610], ['2024-06-04', 630], ['2024-06-05', 640],
    ['2024-06-06', 650], ['2024-06-07', 900], ['2024-06-08', 950], ['2024-06-09', 870], ['2024-06-10', 620],
    ['2024-06-11', 610], ['2024-06-12', 615], ['2024-06-13', 640], ['2024-06-14', 880], ['2024-06-15', 930],
  ]);
}

function makeFBSales() {
  return monthly([
    ['2024-01', 280000], ['2024-02', 260000], ['2024-03', 300000], ['2024-04', 310000], ['2024-05', 325000], ['2024-06', 340000],
  ]);
}

function makeThirdSpaceMembers() {
  return monthly([
    ['2024-01', 220], ['2024-02', 215], ['2024-03', 225], ['2024-04', 230], ['2024-05', 240], ['2024-06', 245],
    ['2024-07', 255], ['2024-08', 260], ['2024-09', 265], ['2024-10', 270], ['2024-11', 275], ['2024-12', 280],
  ]);
}

function run() {
  if (!fs.existsSync(CSV_FILE)) {
    console.error(`CSV not found: ${CSV_FILE}`);
    process.exit(1);
  }
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(BACKUP_DIR, `tenants_demo_for_tagging.csv.timeseries-${ts}.bak`);
  fs.copyFileSync(CSV_FILE, backup);

  const raw = fs.readFileSync(CSV_FILE, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim() !== '');
  if (lines.length < 2) {
    console.error('CSV appears empty');
    process.exit(1);
  }
  const headers = parseCSVLine(lines[0]);
  const idx = Object.fromEntries(headers.map((h, i) => [h.trim(), i]));
  const hasExtended = ['id','canonicalName','country','salesMonthly','membershipsMonthly','visitsDaily'].every((h) => h in idx);
  if (!hasExtended) {
    console.error('CSV is not in extended schema. Please run upgrade script first.');
    process.exit(2);
  }

  const out = [headers.join(',')];
  let modified = 0;
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    if (!row.length) continue;
    const cat = inferCategory(row, idx);
    const sales = row[idx['salesMonthly']] || '';
    const mem = row[idx['membershipsMonthly']] || '';
    const visits = row[idx['visitsDaily']] || '';

    const newRow = row.slice();
    if (!mem && (cat.isFitness || cat.isThirdSpace)) { newRow[idx['membershipsMonthly']] = cat.isFitness ? makeFitnessMembers() : makeThirdSpaceMembers(); modified++; }
    if (!visits && cat.isFB) { newRow[idx['visitsDaily']] = makeFBVisits(); modified++; }
    if (!sales && cat.isFB) { newRow[idx['salesMonthly']] = makeFBSales(); modified++; }
    out.push(newRow.map(csvEscape).join(','));
  }

  fs.writeFileSync(CSV_FILE, out.join('\n'), 'utf8');
  console.log(`Enriched ${modified} time-series fields in ${CSV_FILE}`);
  console.log(`Backup saved: ${backup}`);
}

try { run(); } catch (e) { console.error(e); process.exit(1); }


