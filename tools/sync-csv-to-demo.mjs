// Sync changes from tenants_demo_for_tagging.csv back to tenants_demo.json
// This allows manual CSV edits to be reflected in the application
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv } from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'public', 'data');

const CSV_FILE = path.join(DATA_DIR, 'tenants_demo_for_tagging.csv');
const JSON_FILE = path.join(DATA_DIR, 'tenants_demo.json');

function canonicalize(name) {
  return String(name || '')
    .replace(/\[.*?\]/g, '')
    .replace(/\b(limited|ltd|co\.?|company)\b/gi, '')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase();
}

// Allow grouping related legal entities under a single canonical tenant
function canonicalGroupOverride(name, providedCanonical) {
  const fallback = canonicalize(name);
  const given = String(providedCanonical || '').trim();
  const base = (given || fallback).toUpperCase();
  // Swire Properties group (covers management and real estate agency variants)
  const SWIRE_SET = new Set(['SWIREPROPERTIES', 'SWIREPROPERTIESMANAGEMENT', 'SWIREPROPERTIESREALESTATEAGENCY']);
  if (SWIRE_SET.has(base)) return 'SWIRE PROPERTIES';
  return given || fallback;
}

function makeCompositeKey(name, location, floor, canonicalName) {
  const cn = canonicalGroupOverride(name, canonicalName);
  const loc = String(location || '').trim().toUpperCase();
  const fl = String(floor || '').trim().toUpperCase();
  return `${cn}|${loc}|${fl}`;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// NOTE: All heuristic category inference removed per requirement to use CSV as-is

function isAmenityToken(token) {
  const v = String(token || '').trim().toLowerCase();
  return v === 'y' || v === 'yes' || v === 'true' || v === '1' || v === 'x' || v === 'n' || v === 'no' || v === 'false' || v === '0';
}

function isNumericLike(token) {
  const s = String(token || '').trim();
  if (!s) return false;
  return /^-?\d+(?:\.\d+)?$/.test(s) || /^[\d,]+(?:\.\d+)?$/.test(s);
}

function toNumberOrEmpty(token) {
  const s = String(token || '').replace(/,/g, '').trim();
  if (s === '') return '';
  const n = Number(s);
  return Number.isFinite(n) ? n : '';
}

// Expand a floor string into discrete floor labels similar to the XLSX builder
function expandFloors(input) {
  const out = [];
  const s = String(input || '').trim();
  if (!s) return out;
  const parts = s.split(/[,;&\n]+/).map((p) => p.trim()).filter(Boolean);
  const normalizeToken = (tok) => {
    const m = tok.match(/(LG|UG|G)\/?\s*[fF]?/) || tok.match(/(B\d+)\/?\s*[fF]?/) || tok.match(/(\d+)\s*\/?\s*[fF]?/);
    if (!m) return tok;
    const raw = m[1];
    if (/^(LG|UG|G)$/i.test(raw)) return `${raw.toUpperCase()}`.replace('G', 'G/F');
    if (/^B\d+$/i.test(raw)) return raw.toUpperCase();
    const n = Number(raw);
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

// Repair short 11-col schema rows when floor contains commas (unquoted)
function buildShortRowFromFlexible(values) {
  // Expect the last 4 to be numeric-like: floorspace, rentPerSqFt, monthlyRent, annualRent
  if (values.length < 11) return null;
  const idxStartTail = values.length - 4;
  const tail = values.slice(idxStartTail);
  if (!tail.every(isNumericLike)) {
    // Try to locate a tail of 4 numeric-like tokens by scanning from end
    let found = -1;
    for (let i = values.length - 4; i >= 7; i--) {
      const maybe = values.slice(i, i + 4);
      if (maybe.every(isNumericLike)) { found = i; break; }
    }
    if (found === -1) return null;
    return buildShortRowFromFlexible(values.slice(0, found + 4).concat([]));
  }
  const name = values[0] || '';
  const building = values[1] || '';
  const mid = values.slice(2, values.length - 4);
  let amenIdx = mid.findIndex(isAmenityToken);
  if (amenIdx < 0) amenIdx = 1; // assume single token floor then amenity unknown
  const floorStr = mid.slice(0, Math.max(0, amenIdx)).join(',').trim();
  const amenity = mid[amenIdx] || '';
  const remain = mid.slice(amenIdx + 1);
  const primary = remain[0] || '';
  const secondary = remain[1] || '';
  const tertiary = remain.slice(2).join('|').trim();
  const [floorspace, rentPerSqFt, monthlyRent, annualRent] = tail.map((t) => String(t).replace(/,/g, '').trim());
  return {
    id: '',
    name,
    canonicalName: '',
    building,
    floor: floorStr,
    country: '',
    amenity,
    primary,
    secondary,
    'tertiary (pipe-separated)': tertiary,
    floorspace,
    rentPerSqFt,
    monthlyRent,
    annualRent,
    leaseYears: '',
    leaseStart: '',
    leaseEnd: '',
    salesMonthly: '',
    membershipsMonthly: '',
    visitsDaily: '',
  };
}

function parseMonthNumberPairs(input) {
  // Format: YYYY-MM:value;YYYY-MM:value
  const out = [];
  const s = String(input || '').trim();
  if (!s) return out;
  for (const part of s.split(';')) {
    const [k, v] = part.split(':');
    const month = String((k || '').trim());
    const num = Number((v || '').trim());
    if (month && Number.isFinite(num)) out.push({ month, value: num });
  }
  return out;
}

function parseDateNumberPairs(input) {
  // Format: YYYY-MM-DD:value;YYYY-MM-DD:value
  const out = [];
  const s = String(input || '').trim();
  if (!s) return out;
  for (const part of s.split(';')) {
    const [k, v] = part.split(':');
    const date = String((k || '').trim());
    const num = Number((v || '').trim());
    if (date && Number.isFinite(num)) out.push({ date, value: num });
  }
  return out;
}

function syncCSVToJSON() {
  if (!fs.existsSync(CSV_FILE)) {
    console.error(`CSV file not found: ${CSV_FILE}`);
    return;
  }

  if (!fs.existsSync(JSON_FILE)) {
    console.error(`JSON file not found: ${JSON_FILE}`);
    return;
  }

  // Read current JSON
  const currentJSON = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
  
  // Read CSV
  const csvContent = fs.readFileSync(CSV_FILE, 'utf8');
  const lines = csvContent.split('\n').filter(line => line.trim());
  
  if (lines.length < 2) {
    console.error('CSV file appears to be empty or missing data');
    return;
  }

  // Parse header
  const headers = parseCSVLine(lines[0]);
  const headerIndex = Object.fromEntries(headers.map((h, i) => [h.trim(), i]));
  console.log('CSV Headers:', headers);
  
  // Support both legacy and extended schemas
  const isExtended = 'id' in headerIndex || 'canonicalName' in headerIndex || 'country' in headerIndex;
  
  function buildRowFromExtended(values) {
    if (values.length !== headers.length) return null;
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx];
    });
    return row;
  }

  // Flexible recovery for extended schema when fields like 'floor' contain unquoted commas
  function buildExtendedRowFromFlexible(values) {
    // Expect to recover the last 10 fixed tail fields by position
    // Tail headers (in order):
    const tailHeaders = [
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
    if (values.length < 12) return null;
    const tailCount = tailHeaders.length; // 10
    const tail = values.slice(values.length - tailCount);
    const left = values.slice(0, values.length - tailCount);
    // Left should contain: id,name,canonicalName,building,floor...,country,amenity,primary,secondary,tertiary
    if (left.length < 7) return null;
    const [id, name, canonicalName, building] = left;

    // Find primary ('Office' or 'Retail') position within left
    const primaryIdx = left.findIndex((tok) => /^(Office|Retail)$/i.test(String(tok || '').trim()));
    if (primaryIdx === -1) return null;

    // Find amenity token nearest before primary
    let amenityIdx = -1;
    for (let i = primaryIdx - 1; i >= 4; i--) {
      const v = String(left[i] || '').trim();
      const lc = v.toLowerCase();
      if (lc === 'y' || lc === 'yes' || lc === 'true' || lc === '1' || lc === 'x' || lc === 'n' || lc === 'no' || lc === 'false' || lc === '0') {
        amenityIdx = i;
        break;
      }
    }

    // Country is the token immediately before amenity (if any), else empty
    let country = '';
    let floorTokensEnd = primaryIdx; // exclusive
    if (amenityIdx !== -1) {
      if (amenityIdx - 1 >= 4) country = String(left[amenityIdx - 1] || '').trim();
      floorTokensEnd = Math.max(4, amenityIdx - 1);
    }

    // Floor tokens are between index 4 and floorTokensEnd (exclusive)
    const floorTokens = left.slice(4, floorTokensEnd);
    const floor = floorTokens.map((s) => String(s || '').trim()).filter(Boolean).join(',');

    // Amenity value
    const amenity = amenityIdx !== -1 ? String(left[amenityIdx] || '').trim() : '';

    // Primary/secondary/tertiary
    const primary = String(left[primaryIdx] || '').trim();
    const secondary = String(left[primaryIdx + 1] || '').trim();
    const tertiary = left.slice(primaryIdx + 2).map((s) => String(s || '').trim()).filter(Boolean).join('|');

    // Map tail
    const tailObj = Object.fromEntries(tailHeaders.map((h, i) => [h, tail[i] ?? '']));

    return {
      id: id ?? '',
      name: name ?? '',
      canonicalName: canonicalName ?? '',
      building: building ?? '',
      floor,
      country,
      amenity,
      primary,
      secondary,
      'tertiary (pipe-separated)': tertiary,
      ...tailObj,
    };
  }

  // Short 11-column schema fallback:
  // name,building,floor,amenity,primary,secondary,tertiary (pipe-separated),floorspace,rentPerSqFt,monthlyRent,annualRent
  function buildRowFromShort(values) {
    if (values.length === 11) {
      const [name, building, floor, amenity, primary, secondary, tertiary, floorspace, rentPerSqFt, monthlyRent, annualRent] = values;
      if (!name || !building) return null;
      return {
        id: '',
        name,
        canonicalName: '',
        building,
        floor,
        country: '',
        amenity,
        primary,
        secondary,
        'tertiary (pipe-separated)': tertiary,
        floorspace,
        rentPerSqFt,
        monthlyRent,
        annualRent,
        leaseYears: '',
        leaseStart: '',
        leaseEnd: '',
        salesMonthly: '',
        membershipsMonthly: '',
        visitsDaily: '',
      };
    }
    // Flexible recovery for rows with commas inside floor
    return buildShortRowFromFlexible(values);
  }
  
  // Create a map of CSV data by best key: prefer id, else name+building+floor
  const csvDataById = new Map();
  const csvDataByComposite = new Map(); // canonicalName|location|floor

  function isAmenityRow(row) {
    const v = String(row.amenity || '').trim().toLowerCase();
    return v === 'y' || v === 'yes' || v === 'true' || v === '1' || v === 'x';
  }

  function pickBetterRow(prev, next) {
    if (!prev) return next;
    const prevAmenity = isAmenityRow(prev);
    const nextAmenity = isAmenityRow(next);
    // Prefer amenity rows over non-amenity
    if (prevAmenity && !nextAmenity) return prev;
    if (!prevAmenity && nextAmenity) return next;
    // Otherwise prefer the later row (next wins)
    return next;
  }
  
  function splitRowByFloor(row) {
    const floorsList = expandFloors(row.floor);
    if (floorsList.length <= 1) {
      return [{ ...row, floor: (row.floor || '').trim() }];
    }
    const count = floorsList.length;
    const fsNum = toNumberOrEmpty(row.floorspace);
    const mrNum = toNumberOrEmpty(row.monthlyRent);
    const arNum = toNumberOrEmpty(row.annualRent);
    const rpsfNum = toNumberOrEmpty(row.rentPerSqFt);
    let perFs = Array(count).fill('');
    let perMr = Array(count).fill('');
    let perAr = Array(count).fill('');
    if (typeof fsNum === 'number' && fsNum > 0) {
      const each = Math.floor((fsNum / count) * 100) / 100;
      perFs = floorsList.map(() => each);
      perFs[perFs.length - 1] = Number((fsNum - each * (count - 1)).toFixed(2));
    }
    if (typeof mrNum === 'number' && mrNum > 0) {
      const each = Math.round(mrNum / count);
      perMr = floorsList.map(() => each);
      perMr[perMr.length - 1] = mrNum - each * (count - 1);
    }
    if (typeof arNum === 'number' && arNum > 0) {
      const each = Math.round(arNum / count);
      perAr = floorsList.map(() => each);
      perAr[perAr.length - 1] = arNum - each * (count - 1);
    }
    return floorsList.map((fl, idx) => ({
      ...row,
      floor: fl,
      floorspace: perFs[idx] !== '' ? String(perFs[idx]) : row.floorspace,
      monthlyRent: perMr[idx] !== '' ? String(perMr[idx]) : row.monthlyRent,
      annualRent: perAr[idx] !== '' ? String(perAr[idx]) : row.annualRent,
      rentPerSqFt: rpsfNum !== '' ? String(rpsfNum) : row.rentPerSqFt,
    }));
  }

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    let row = null;
    if (isExtended) {
      // Extended-first parsing
      row = buildRowFromExtended(values);
      if (!row) row = buildExtendedRowFromFlexible(values);
      if (!row) row = buildRowFromShort(values);
    } else {
      // Short-first parsing
      row = buildRowFromShort(values);
      if (!row) row = buildShortRowFromFlexible(values);
      // Heuristic: if still no row, attempt extended-flexible only if looks like extended
      if (!row) {
        const first = String(values[0] || '').trim();
        const third = String(values[2] || '').trim();
        const hasPrimaryToken = values.some((tok) => /^(Office|Retail)$/i.test(String(tok || '').trim()));
        const looksLikeId = first === '' || /^\d+$/.test(first);
        const looksCanonical = /^(?:[A-Z0-9]){6,}$/.test(third);
        if (hasPrimaryToken && (looksLikeId || looksCanonical)) {
          row = buildExtendedRowFromFlexible(values);
        }
      }
    }
    if (!row) {
      console.warn(`Line ${i + 1} has ${values.length} values; could not parse as extended (${headers.length}) or short (11), skipping`);
      continue;
    }
    const rowsToAdd = splitRowByFloor(row);
    for (const r of rowsToAdd) {
      const idStr = (r.id || '').trim();
      const idNum = idStr ? Number(idStr) : NaN;
      if (!Number.isNaN(idNum) && idNum > 0) {
        const prev = csvDataById.get(idNum);
        csvDataById.set(idNum, pickBetterRow(prev, r));
      }
      const name = (r.name || '').trim();
      const building = (r.building || '').trim();
      const floor = (r.floor || '').trim();
      const canonical = (r.canonicalName || '').trim();
      if (name && building) {
        const key = makeCompositeKey(name, building, floor, canonical);
        const prev = csvDataByComposite.get(key);
        csvDataByComposite.set(key, pickBetterRow(prev, r));
      }
    }
  }

  console.log(`Parsed ${csvDataById.size + csvDataByComposite.size} rows from CSV`);

  // Precompute max id for upserts
  let maxId = currentJSON.reduce((m, t) => Math.max(m, Number(t.id) || 0), 0);

  // Helper to transform CSV row into a tenant object overlay
  function rowToTenantOverlay(row, baseTenant) {
    const name = (row.name || baseTenant?.name || '').trim();
    // Country must come strictly from CSV to avoid post-hoc injection
    const country = String(row.country || '').trim();
    const building = (row.building || baseTenant?.location || '').trim();
    const floor = (row.floor || baseTenant?.floor || '').trim();
    const amenityRaw = String(row.amenity || '').trim().toLowerCase();
    const isAmenity = amenityRaw === 'y' || amenityRaw === 'yes' || amenityRaw === 'true' || amenityRaw === '1' || amenityRaw === 'x';
    const primaryRaw = (row.primary || '').trim();
    const secondary = (row.secondary || '').trim();
    const tertiary = String(row['tertiary (pipe-separated)'] || '')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    const primary = primaryRaw ? `${primaryRaw} (Land Use)` : (baseTenant?.landUse || 'Office (Land Use)');
    const floorspace = row.floorspace !== undefined && row.floorspace !== '' ? Number(row.floorspace) : baseTenant?.floorspace;
    const rentPerSqFt = row.rentPerSqFt !== undefined && row.rentPerSqFt !== '' ? Number(row.rentPerSqFt) : baseTenant?.rentPerSqFt;
    const monthlyRent = row.monthlyRent !== undefined && row.monthlyRent !== '' ? Number(row.monthlyRent) : baseTenant?.monthlyRent;
    const annualRent = row.annualRent !== undefined && row.annualRent !== '' ? Number(row.annualRent) : baseTenant?.annualRent;
    const leaseYears = row.leaseYears !== undefined && row.leaseYears !== '' ? Number(row.leaseYears) : baseTenant?.leaseYears;
    const leaseStart = (row.leaseStart !== undefined ? row.leaseStart : baseTenant?.leaseStart) || '';
    const leaseEnd = (row.leaseEnd !== undefined ? row.leaseEnd : baseTenant?.leaseEnd) || '';
    const canonical = canonicalGroupOverride(name, row.canonicalName || baseTenant?.canonicalName);

    // Tags: STRICTLY from CSV
    const tags = [primary];
    if (secondary) tags.push(secondary);
    if (tertiary.length) tags.push(...tertiary);
    if (isAmenity) tags.push('Amenity');

    // Optional time series
    // salesMonthly: CSV format YYYY-MM:sales;YYYY-MM:sales
    let salesMonthly = baseTenant?.salesMonthly;
    let salesByYear = baseTenant?.salesByYear;
    if ('salesMonthly' in row && row.salesMonthly !== '') {
      const parsed = parseMonthNumberPairs(row.salesMonthly).map(r => ({ month: r.month, sales: r.value }));
      if (parsed.length) {
        salesMonthly = parsed;
        const byYear = new Map();
        for (const r of parsed) {
          const y = String(r.month).slice(0, 4);
          byYear.set(y, (byYear.get(y) || 0) + Number(r.sales || 0));
        }
        salesByYear = Array.from(byYear.entries()).map(([year, sales]) => ({ year, sales }));
      }
    }

    // membershipsMonthly: CSV format YYYY-MM:members;YYYY-MM:members
    let membershipsMonthly = baseTenant?.membershipsMonthly;
    if ('membershipsMonthly' in row && row.membershipsMonthly !== '') {
      const parsed = parseMonthNumberPairs(row.membershipsMonthly).map(r => ({ month: r.month, members: r.value }));
      if (parsed.length) membershipsMonthly = parsed;
    }

    // visitsDaily: CSV format YYYY-MM-DD:visits;YYYY-MM-DD:visits
    let visitsDaily = baseTenant?.visitsDaily;
    let visitsMonthly = baseTenant?.visitsMonthly;
    let visitsByYear = baseTenant?.visitsByYear;
    if ('visitsDaily' in row && row.visitsDaily !== '') {
      const parsed = parseDateNumberPairs(row.visitsDaily).map(r => ({ date: r.date, visits: r.value }));
      if (parsed.length) {
        visitsDaily = parsed;
        // Aggregate to monthly
        const byMonth = new Map();
        for (const r of parsed) {
          const ym = String(r.date).slice(0, 7);
          byMonth.set(ym, (byMonth.get(ym) || 0) + Number(r.visits || 0));
        }
        visitsMonthly = Array.from(byMonth.entries()).map(([month, visits]) => ({ month, visits }));
        const byYear = new Map();
        for (const m of visitsMonthly) {
          const y = m.month.slice(0, 4);
          byYear.set(y, (byYear.get(y) || 0) + Number(m.visits || 0));
        }
        visitsByYear = Array.from(byYear.entries()).map(([year, visits]) => ({ year, visits }));
      }
    }

    return {
      name,
      location: building,
      country,
      landUse: primary,
      tags: Array.from(new Set(tags)),
      floorspace: Number.isFinite(floorspace) ? floorspace : (baseTenant?.floorspace || 0),
      rentPerSqFt: Number.isFinite(rentPerSqFt) ? rentPerSqFt : (baseTenant?.rentPerSqFt || 0),
      monthlyRent: Number.isFinite(monthlyRent) ? monthlyRent : (baseTenant?.monthlyRent || 0),
      annualRent: Number.isFinite(annualRent) ? annualRent : (baseTenant?.annualRent || 0),
      leaseYears: Number.isFinite(leaseYears) ? leaseYears : (baseTenant?.leaseYears || 0),
      leaseStart,
      leaseEnd,
      floor,
      canonicalName: canonical,
      // Also persist explicit category helpers for debugging/consistency
      _secondary: secondary || '',
      _tertiary: tertiary[0] || '',
      salesMonthly,
      salesByYear,
      membershipsMonthly,
      visitsDaily,
      visitsMonthly,
      visitsByYear
    };
  }

  // Update or upsert
  let updatedCount = 0;
  const byId = new Map(currentJSON.map(t => [Number(t.id) || 0, t]));
  const byComposite = new Map(currentJSON.map(t => [makeCompositeKey(t.name, t.location, t.floor, t.canonicalName), t]));

  const updatedJSON = currentJSON.map(tenant => {
    const idKey = Number(tenant.id) || 0;
    const compositeKey = makeCompositeKey(tenant.name, tenant.location, tenant.floor, tenant.canonicalName);
    // Prefer composite match to resolve duplicate/conflicting rows across schemas
    const csvRow = csvDataByComposite.get(compositeKey) || (idKey && csvDataById.get(idKey));
    if (!csvRow) {
      return tenant;
    }
    const overlay = rowToTenantOverlay(csvRow, tenant);
    updatedCount++;
    return { ...tenant, ...overlay };
  });

  // Upsert: add rows present in CSV but not in JSON
  const existingKeys = new Set(updatedJSON.map(t => `${t.name}|${t.location}|${(t.floor || '').trim()}`));
  const existingCanonicalKeys = new Set(updatedJSON.map(t => makeCompositeKey(t.name, t.location, t.floor, t.canonicalName)));
  for (const row of [...csvDataById.values(), ...csvDataByComposite.values()]) {
    const name = (row.name || '').trim();
    const building = (row.building || '').trim();
    const floor = (row.floor || '').trim();
    const composite = `${name}|${building}|${floor}`;
    const idStr = (row.id || '').trim();
    const idNum = idStr ? Number(idStr) : NaN;
    const exists = (idStr && byId.has(Number(idStr))) || existingKeys.has(composite) || existingCanonicalKeys.has(makeCompositeKey(name, building, floor, row.canonicalName));
    if (exists) continue;
    const newId = Number.isFinite(idNum) && idNum > 0 ? idNum : (++maxId);
    const overlay = rowToTenantOverlay(row, undefined);
    updatedJSON.push({
      id: newId,
      ...overlay
    });
    updatedCount++;
  }

  // No further normalization: keep categories exactly as provided by CSV
  const normalizedAll = updatedJSON;

  // Deduplicate by canonicalName|location|floor (prefer Amenity-tagged or more specific categories; else latest wins)
  function isAmenityTenant(t) {
    try {
      if (t._amenity) return true;
      if (Array.isArray(t.tags)) return t.tags.includes('Amenity');
    } catch {}
    return false;
  }
  function specificityScore(t) {
    let score = 0;
    try {
      if (Array.isArray(t.tags)) {
        if (t.tags.includes('F&B') || t.tags.includes('Fitness') || t.tags.includes('Healthcare') || t.tags.includes('Third Space') || t.tags.includes('Retail and Convenience')) score += 2;
        const tertCount = t.tags.filter((x) => !/\(Land Use\)/.test(String(x)) && !['Amenity','F&B','Fitness','Healthcare','Third Space','Retail and Convenience'].includes(String(x))).length;
        score += Math.min(tertCount, 3);
      }
      if (t._secondary) score += 1;
      if (t._tertiary) score += 1;
    } catch {}
    return score;
  }
  const bestByComposite = new Map();
  for (const t of normalizedAll) {
    const key = makeCompositeKey(t.name, t.location, t.floor, t.canonicalName);
    const prev = bestByComposite.get(key);
    if (!prev) {
      bestByComposite.set(key, t);
      continue;
    }
    const prevAmen = isAmenityTenant(prev);
    const nextAmen = isAmenityTenant(t);
    if (!prevAmen && nextAmen) {
      bestByComposite.set(key, t);
      continue;
    }
    if (prevAmen && !nextAmen) {
      continue;
    }
    const prevSpec = specificityScore(prev);
    const nextSpec = specificityScore(t);
    if (nextSpec > prevSpec) {
      bestByComposite.set(key, t);
      continue;
    }
    // If tie, prefer the later one (current t)
    bestByComposite.set(key, t);
  }
  const dedupedJSON = Array.from(bestByComposite.values());

  // Write updated JSON
  fs.writeFileSync(JSON_FILE, JSON.stringify(dedupedJSON, null, 2), 'utf8');
  
  console.log(`Upserted/updated ${updatedCount} tenants in ${JSON_FILE}`);
  console.log('CSV changes have been synced to the demo dataset!');
  
  if (argv.includes('--watch')) {
    console.log('Watching CSV for changes...');
    let debounce;
    const rerun = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        try {
          syncCSVToJSON();
        } catch (e) {
          console.error('Failed to re-sync after CSV change:', e);
        }
      }, 200);
    };
    fs.watch(CSV_FILE, { persistent: true }, rerun);
  }
}

try {
  syncCSVToJSON();
} catch (error) {
  console.error('Error syncing CSV to JSON:', error);
  process.exit(1);
}
