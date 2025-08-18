// Build tenant dataset from the Excel workbook placed at project root.
// Usage: node scripts/build-tenants-from-xlsx.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// NOTE: Confidential sources are no longer committed. Place the Excel locally under data-sources/ if you
// need to regenerate, but do not commit the files.
const INPUT_FILE = path.join(ROOT, 'data-sources', 'Tenant list to upload to Cursor.xlsx');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const AMENITY_FILE = path.join(ROOT, 'data-sources', 'Amenity master copy (Aug 2025).xlsx');

function normalizeNumber(v) {
  if (typeof v === 'number') return v;
  if (v == null) return 0;
  const cleaned = String(v).replace(/[^0-9.]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// Extract total area from cells that may contain multiple lines and a bracketed total, e.g.:
// "21,853 SF\n21,853 SF\n(43,706 SF)"
function parseAreaCell(v) {
  if (v == null) return 0;
  const s = String(v);
  // Prefer explicit total shown in parentheses
  const paren = s.match(/\(([\d,\.]+)\s*SF?\)/i) || s.match(/\(([\d,\.]+)\)/);
  if (paren && paren[1]) return normalizeNumber(paren[1]);
  // Else sum all numeric occurrences (handles multi-line with several values)
  const matches = [...s.matchAll(/([\d]{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*SF?/gi)].map((m) => normalizeNumber(m[1]));
  if (matches.length === 0) return normalizeNumber(s);
  if (matches.length === 1) return matches[0];
  return matches.reduce((a, b) => a + b, 0);
}

function pickField(row, candidates) {
  const keys = Object.keys(row);
  for (const key of keys) {
    const lower = String(key).toLowerCase();
    for (const c of candidates) {
      if (lower.includes(c)) return row[key];
    }
  }
  return undefined;
}

function getField(row, exactKey) {
  const wanted = String(exactKey).toLowerCase();
  for (const k of Object.keys(row)) {
    if (String(k).toLowerCase().trim() === wanted) return row[k];
  }
  return undefined;
}

function headerize(rows2d) {
  const looksLikeHeader = (row) => {
    const s = row.map((v) => String(v || '').toLowerCase()).join(' ');
    return /tenant|company|name|occupant/.test(s) || (/nfa|area|sq\s*ft|sf|unit/.test(s) && /floor|level|unit|room|suite/.test(s));
  };
  let idx = rows2d.findIndex(looksLikeHeader);
  if (idx < 0) idx = 0;
  const headers = rows2d[idx].map((h, i) => (h ? String(h) : `col_${i + 1}`));
  const dataRows = rows2d.slice(idx + 1).filter((r) => r.some((v) => String(v || '').trim() !== ''));
  return dataRows.map((r) => Object.fromEntries(r.map((v, i) => [headers[i], v])));
}

// Expand a floor string into discrete floor labels.
// Examples:
//  - "25/F-27/F" -> ["25/F", "26/F", "27/F"]
//  - "25/F, 27/F" -> ["25/F", "27/F"]
//  - "25-27" -> ["25/F", "26/F", "27/F"]
function expandFloors(input) {
  const out = [];
  const s = String(input || '').trim();
  if (!s) return out;
  const parts = s.split(/[,;&\n]+/).map((p) => p.trim()).filter(Boolean);
  const normalizeToken = (tok) => {
    const m = tok.match(/(\d+)\s*\/?\s*[fF]?/);
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) ? `${n}/F` : tok;
  };
  for (const part of parts) {
    const range = part.match(/(\d+)\s*\/?\s*[fF]?\s*[-–to]+\s*(\d+)\s*\/?\s*[fF]?/i);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const [start, end] = a <= b ? [a, b] : [b, a];
        for (let i = start; i <= end; i++) out.push(`${i}/F`);
        continue;
      }
    }
    out.push(normalizeToken(part));
  }
  return out.filter(Boolean);
}

// Parse area strings that may include per-floor values and a bracketed total.
// Returns { perFloor: number[], total: number }
function parseAreaDetailed(v) {
  const s = String(v ?? '');
  const totalMatch = s.match(/\(([^\d)]*?)([\d,\.]+)\s*SF?\)/i) || s.match(/\(([\d,\.]+)\)/);
  const total = totalMatch ? normalizeNumber(totalMatch[2] ?? totalMatch[1]) : 0;
  const withoutParens = s.replace(/\([^)]*\)/g, ' ');
  const nums = [...withoutParens.matchAll(/([\d]{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*SF?/gi)].map((m) => normalizeNumber(m[1]));
  return { perFloor: nums, total };
}

function loadAmenityMappings() {
  try {
    if (!fs.existsSync(AMENITY_FILE)) return new Map();
    const wb = XLSX.readFile(AMENITY_FILE, { cellDates: false });
    const map = new Map(); // canonicalName -> { amenity, primary, secondary, tertiary[] }
    const truthy = (v) => {
      const s = String(v ?? '').trim().toLowerCase();
      return (
        s === 'y' ||
        s === 'yes' ||
        s === 'true' ||
        s === '1' ||
        s === '✓' ||
        s === '√' ||
        s === 'tick' ||
        s === '✔' ||
        s === 'x'
      );
    };
    const fieldByIncludes = (row, needles) => {
      const keys = Object.keys(row);
      for (const k of keys) {
        const lk = String(k).toLowerCase();
        if (needles.some((n) => lk.includes(n))) return row[k];
      }
      return undefined;
    };
    const toArray = (v) => {
      if (v == null) return [];
      const s = String(v).trim();
      if (!s) return [];
      return s
        .split(/\||,|;|\n/)
        .map((p) => p.trim())
        .filter(Boolean);
    };
    const canonicalize = (name) =>
      String(name || '')
        .replace(/\[.*?\]/g, '')
        .replace(/\b(limited|ltd|co\.?|company)\b/gi, '')
        .replace(/[^a-z0-9]/gi, '')
        .toUpperCase();

    for (const sheet of wb.SheetNames) {
      const ws = wb.Sheets[sheet];
      const rowsAoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const rows = headerize(rowsAoa);
      for (const row of rows) {
        const name =
          row['Non-Office tenants under TPMO'] ??
          row['Tenant'] ??
          row['Facility'] ??
          row['Name'] ??
          row['Company'] ??
          fieldByIncludes(row, ['non-office tenants under tpmo', 'tenant', 'facility', 'brand', 'company', 'name']) ??
          '';
        const cn = canonicalize(name);
        if (!cn) continue;
        const primary = (
          row['Land Use'] ??
          row['Primary'] ??
          fieldByIncludes(row, ['land use', 'primary', 'use']) ??
          ''
        )
          .toString()
          .trim();
        const secondary = (
          row['Secondary'] ?? row['Category'] ?? fieldByIncludes(row, ['secondary', 'category', 'sec']) ?? ''
        )
          .toString()
          .trim();
        const tertiary = toArray(
          row['Tertiary'] ?? row['Sub-Category'] ?? fieldByIncludes(row, ['tertiary', 'sub', 'sub-category', 'tags'])
        );
        const amenity =
          truthy(
            row['Amenity'] ?? row['Amenity?'] ?? row['Amenity Tag'] ?? fieldByIncludes(row, ['amenity'])
          ) || !!row['Non-Office tenants under TPMO'];
        if (!map.has(cn)) map.set(cn, { amenity, primary, secondary, tertiary });
        else {
          const cur = map.get(cn);
          // Prefer truthy amenity and non-empty fields
          map.set(cn, {
            amenity: cur.amenity || amenity,
            primary: cur.primary || primary,
            secondary: cur.secondary || secondary,
            tertiary: cur.tertiary?.length ? cur.tertiary : tertiary,
          });
        }
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

function parseWorkbook() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Input Excel not found at: ${INPUT_FILE}`);
  }
  const wb = XLSX.readFile(INPUT_FILE, { cellDates: false });
  const perBuildingTotals = {}; // { [building]: { totalArea, vacantArea } }
  const tenantsPerFloor = []; // one row per floor
  const canonicalize = (name) =>
    String(name || '')
      .replace(/\[.*?\]/g, '')
      .replace(/\b(limited|ltd|co\.?|company)\b/gi, '')
      .replace(/[^a-z0-9]/gi, '')
      .toUpperCase();
  let nextId = 1;
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    // Use 2D parsing with heuristic header detection (worked with your book earlier)
    const rowsAoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const rows = headerize(rowsAoa);
    let added = 0;
    let logged = false;
    let previousWasVacant = false;
    for (const row of rows) {
      if (!logged) {
        console.log(`Headers detected for ${sheetName}:`, Object.keys(row).join(' | '));
        logged = true;
      }
      const name = getField(row, 'Tenant');
      const areaVal = getField(row, 'Area');
      const floor = getField(row, 'Floors') ?? getField(row, 'Floor') ?? getField(row, 'Level');
      const nameStr = String(name || '').trim();
      if (!nameStr) continue;
      const floorsList = expandFloors(floor);
      const { perFloor, total } = parseAreaDetailed(areaVal);
      let perFloorAreas = [];
      if (floorsList.length && perFloor.length === floorsList.length) {
        perFloorAreas = perFloor;
      } else if (floorsList.length && total > 0) {
        const each = Math.floor((total / floorsList.length) * 100) / 100;
        perFloorAreas = floorsList.map(() => each);
        const remainder = total - each * floorsList.length;
        if (perFloorAreas.length) perFloorAreas[perFloorAreas.length - 1] += remainder;
      } else if (floorsList.length && perFloor.length > 0) {
        const sum = perFloor.reduce((a, b) => a + b, 0);
        const each = Math.floor((sum / floorsList.length) * 100) / 100;
        perFloorAreas = floorsList.map(() => each);
        const remainder = sum - each * floorsList.length;
        if (perFloorAreas.length) perFloorAreas[perFloorAreas.length - 1] += remainder;
      } else if (!floorsList.length && (total > 0 || perFloor.length > 0)) {
        const single = total || perFloor.reduce((a, b) => a + b, 0);
        perFloorAreas = [single];
      }
      const rowTotalArea = perFloorAreas.reduce((a, b) => a + (Number(b) || 0), 0);
      if (!rowTotalArea) { previousWasVacant = false; continue; }

      // Init building totals
      if (!perBuildingTotals[sheetName]) perBuildingTotals[sheetName] = { totalArea: 0, vacantArea: 0 };
      perBuildingTotals[sheetName].totalArea += rowTotalArea;

      const isFuture = /\[\s*future\s*\]/i.test(nameStr);
      const isVacant = /(^|\s)(--\s*vacant\s*--|vacant)(\s|$)/i.test(nameStr);
      const isLastTenant = /last\s*tenant/i.test(nameStr);

      if (isVacant) {
        perBuildingTotals[sheetName].vacantArea += rowTotalArea;
        previousWasVacant = true;
        continue;
      }
      if (isLastTenant && previousWasVacant) {
        // Count area under vacancy total when the previous row was a VACANT marker
        perBuildingTotals[sheetName].vacantArea += rowTotalArea;
        previousWasVacant = false;
        continue;
      }
      previousWasVacant = false;
      if (isFuture) {
        // Future space is unoccupied for now
        perBuildingTotals[sheetName].vacantArea += rowTotalArea;
        continue;
      }

      const landUse = 'Office (Land Use)';
      const rpsfBase = 40 + Math.round(Math.random() * 30);
      const canonical = canonicalize(nameStr);
      const floorsOut = floorsList.length ? floorsList : [''];
      const areasOut = perFloorAreas.length ? perFloorAreas : [rowTotalArea];
      for (let i = 0; i < Math.max(floorsOut.length, areasOut.length); i++) {
        const fl = floorsOut[i] ?? floorsOut[floorsOut.length - 1];
        const area = Number(areasOut[i] ?? areasOut[areasOut.length - 1]) || 0;
        const monthly = Math.round(rpsfBase * area);
        tenantsPerFloor.push({
          id: nextId++,
          name: nameStr,
          canonicalName: canonical,
          location: sheetName,
          landUse,
          tags: [landUse],
          floorspace: area,
          rentPerSqFt: rpsfBase,
          monthlyRent: monthly,
          annualRent: monthly * 12,
          floor: fl,
          premium: false,
          leaseYears: 0,
          leaseStart: '',
          leaseEnd: '',
          occupancyRate: 0,
        });
      }
      added += 1;
    }
    console.log(`Sheet ${sheetName}: ${rows.length} rows -> ${added} tenants`);
  }
  // Load amenity/land-use/tag mappings
  const amenityMap = loadAmenityMappings();
  const getEnrichment = (cn) => {
    if (amenityMap.has(cn)) return amenityMap.get(cn);
    // fallback: substring match either way to handle LTD/LIMITED mismatches
    for (const [k, v] of amenityMap.entries()) {
      if (cn.includes(k) || k.includes(cn)) return v;
    }
    return undefined;
  };

  // Enrich per-floor tenants
  const tenants = tenantsPerFloor.map((t) => {
    const enrich = getEnrichment(t.canonicalName) || {};
    const primary = String(enrich.primary || '').toLowerCase().startsWith('retail') ? 'Retail (Land Use)' : t.landUse;
    const tags = new Set(t.tags);
    if (enrich.secondary) tags.add(enrich.secondary);
    if (Array.isArray(enrich.tertiary)) enrich.tertiary.forEach((tt) => tt && tags.add(tt));
    if (enrich.amenity) tags.add('Amenity');
    const rpsf = t.floorspace ? Math.round((t.monthlyRent / t.floorspace) * 100) / 100 : t.rentPerSqFt || 0;
    return {
      ...t,
      landUse: primary,
      tags: Array.from(tags),
      rentPerSqFt: rpsf,
      _amenity: !!enrich.amenity,
      _secondary: enrich.secondary || '',
      _tertiary: Array.isArray(enrich.tertiary) ? enrich.tertiary.join('|') : '',
    };
  });
  return { tenants, perBuildingTotals };
}

function writeOutputs(tenants) {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, 'tenants_master.json');
  fs.writeFileSync(jsonPath, JSON.stringify(tenants, null, 2), 'utf8');
  const csvHeaders = [
    'name',
    'building',
    'floor',
    'amenity',
    'primary',
    'secondary',
    'tertiary (pipe-separated)',
    'floorspace',
    'rentPerSqFt',
    'monthlyRent',
    'annualRent'
  ];
  const lines = [csvHeaders.join(',')];
  for (const t of tenants) {
    lines.push([
      t.name,
      t.location,
      t.floor || '',
      t._amenity ? 'Y' : 'N',
      t.landUse.replace(' (Land Use)', ''),
      t._secondary || '',
      t._tertiary || '',
      t.floorspace,
      t.rentPerSqFt,
      t.monthlyRent,
      t.annualRent
    ].join(','));
  }
  const csvPath = path.join(OUT_DIR, 'tenants_master_for_tagging.csv');
  fs.writeFileSync(csvPath, lines.join('\n'), 'utf8');
  return { jsonPath, csvPath };
}

try {
  const { tenants, perBuildingTotals } = parseWorkbook();
  const { jsonPath, csvPath } = writeOutputs(tenants);
  // write building totals for occupancy
  const bsPath = path.join(OUT_DIR, 'building_stats.json');
  fs.writeFileSync(
    bsPath,
    JSON.stringify(
      Object.entries(perBuildingTotals).map(([location, v]) => ({ location, totalArea: v.totalArea, vacantArea: v.vacantArea })),
      null,
      2
    ),
    'utf8'
  );
  console.log(`Wrote ${tenants.length} tenants`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV : ${csvPath}`);
  console.log(`Building stats: ${bsPath}`);
} catch (err) {
  console.error(err);
  process.exit(1);
}


