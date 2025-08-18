// Build a simplified, demo-ready dataset from the existing master JSON.
// Excludes vacant/future/review records and assigns synthetic tags when missing.
// Outputs public/data/tenants_demo.json and public/data/tenants_demo_for_tagging.csv
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA_DIR = path.join(ROOT, 'public', 'data');
const SRC = path.join(DATA_DIR, 'tenants_master.json');
const OUT_JSON = path.join(DATA_DIR, 'tenants_demo.json');
const OUT_CSV = path.join(DATA_DIR, 'tenants_demo_for_tagging.csv');
// Optional: if present locally, amenity mappings can enrich the demo. This file is not committed.
const AMENITY_FILE = path.join(ROOT, 'data-sources', 'Amenity master copy (Aug 2025).xlsx');

const COLORS = ['Office (Land Use)', 'Retail (Land Use)'];

const SECONDARY_TAGS = [
  'F&B',
  'Retail and Convenience',
  'Third Space',
  'Fitness',
  'Healthcare',
  'Trade Categories',
];

const TERTIARY_BY_SECONDARY = {
  'F&B': ['Café', 'Restaurant', 'Bakery', 'Grab and Go', 'Food Hall', 'Bar'],
  'Retail and Convenience': ['Banking', 'Beauty', 'Health', 'Fashion (Shopping)', 'Smart Locker'],
  'Third Space': ["Event Space", "Member's Club", 'Co-working spaces'],
  Fitness: ['Golf', 'Gym', 'Movement Studio', 'Yoga Studio', 'Physiotherapy'],
  Healthcare: ['Dental Clinic', 'Medical Clinic'],
  'Trade Categories': [
    'Banking and Financial Services',
    'Technology Media and Telecoms (TMT)',
    'Insurance',
    'Real Estate and Construction',
    'Fashion/Retail',
  ],
};

function canonicalize(name) {
  return String(name || '')
    .replace(/\[.*?\]/g, '')
    .replace(/\b(limited|ltd|co\.?|company)\b/gi, '')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase();
}

function loadAmenityMappings() {
  const map = new Map(); // canonical -> { amenity:boolean, primary, secondary, tertiary[] }
  if (!fs.existsSync(AMENITY_FILE)) return map;
  const wb = XLSX.readFile(AMENITY_FILE, { cellDates: false });
  const toArray = (v) => String(v ?? '').split(/\||,|;|\n/).map((s) => s.trim()).filter(Boolean);
  const truthy = (v) => {
    const s = String(v ?? '').trim().toLowerCase();
    return ['y', 'yes', 'true', '1', '✓', '✔', '√', 'x'].includes(s);
  };
  for (const sheet of wb.SheetNames) {
    const ws = wb.Sheets[sheet];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    for (const row of rows) {
      // Required columns per user: 'Amenity', 'Non-Office tenants under TPMO', 'Land Use', 'Category', 'Sub-Category'
      const name = row['Non-Office tenants under TPMO'] || row['Tenant'] || row['Brand'] || '';
      const cn = canonicalize(name);
      if (!cn) continue;
      map.set(cn, {
        amenity: truthy(row['Amenity']),
        primary: String(row['Land Use'] || '').trim(),
        secondary: String(row['Category'] || '').trim(),
        tertiary: toArray(row['Sub-Category']),
      });
    }
  }
  return map;
}

function inferPrimary(tenant) {
  if (tenant.landUse === COLORS[1] || /retail/i.test(tenant.landUse || '')) return COLORS[1];
  // Heuristic from name
  const n = String(tenant.name || '').toLowerCase();
  if (/(shop|store|cafe|café|restaurant|locker|bank|beauty)/.test(n)) return COLORS[1];
  return COLORS[0];
}

function inferSecondary(name) {
  const n = String(name || '').toLowerCase();
  if (/(yoga|gym|fitness|golf|pilates|studio|movement|spin|boxing|physio)/.test(n)) return 'Fitness';
  if (/(dental|clinic|medical|healthcare|doctor|derma|med)/.test(n)) return 'Healthcare';
  if (/(bank|atm|locker|beauty|salon|fashion|retail|convenience|store|shop)/.test(n)) return 'Retail and Convenience';
  if (/(cafe|café|coffee|bar|restaurant|kitchen|bakery|salad|pizza|tea)/.test(n)) return 'F&B';
  if (/(club|cowork|co-working|event|space|member)/.test(n)) return 'Third Space';
  return 'Trade Categories';
}

function inferTertiary(secondary, name) {
  const n = String(name || '').toLowerCase();
  if (secondary === 'F&B') {
    if (/(cafe|café|coffee)/.test(n)) return 'Café';
    if (/restaurant/.test(n)) return 'Restaurant';
    if (/bakery/.test(n)) return 'Bakery';
    if (/(grab|go)/.test(n)) return 'Grab and Go';
    if (/bar/.test(n)) return 'Bar';
  }
  if (secondary === 'Retail and Convenience') {
    if (/bank/.test(n)) return 'Banking';
    if (/beauty|salon/.test(n)) return 'Beauty';
    if (/(health|pharm)/.test(n)) return 'Health';
    if (/locker/.test(n)) return 'Smart Locker';
    if (/(fashion|retail|store|shop)/.test(n)) return 'Fashion (Shopping)';
  }
  if (secondary === 'Third Space') {
    if (/event/.test(n)) return 'Event Space';
    if (/(cowork|co-working)/.test(n)) return 'Co-working spaces';
    if (/club/.test(n)) return "Member's Club";
  }
  if (secondary === 'Fitness') {
    if (/golf/.test(n)) return 'Golf';
    if (/gym|fitness/.test(n)) return 'Gym';
    if (/yoga/.test(n)) return 'Yoga Studio';
    if (/physio/.test(n)) return 'Physiotherapy';
    if (/studio|movement|dance/.test(n)) return 'Movement Studio';
  }
  if (secondary === 'Healthcare') {
    if (/dental/.test(n)) return 'Dental Clinic';
    if (/clinic|medical/.test(n)) return 'Medical Clinic';
  }
  if (secondary === 'Trade Categories') {
    if (/bank|finance/.test(n)) return 'Banking and Financial Services';
    if (/tmt|telecom|tech|media/.test(n)) return 'Technology Media and Telecoms (TMT)';
    if (/insurance/.test(n)) return 'Insurance';
    if (/real\s*estate|construction/.test(n)) return 'Real Estate and Construction';
    if (/fashion|retail/.test(n)) return 'Fashion/Retail';
  }
  // Fallback: first option
  return (TERTIARY_BY_SECONDARY[secondary] || [])[0] || '';
}

function main() {
  const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const amenityMap = loadAmenityMappings();
  const filtered = raw.filter((t) => {
    const n = String(t.name || '').toLowerCase();
    return !(/vacant|--\s*vacant\s*--|future|rent\s*review/.test(n));
  });

  const out = filtered.map((t) => {
    const cn = canonicalize(t.name);
    const enrich = amenityMap.get(cn);
    const primary = enrich?.primary ? (enrich.primary.toLowerCase().startsWith('retail') ? 'Retail (Land Use)' : 'Office (Land Use)') : inferPrimary(t);
    const secondary = enrich?.secondary || inferSecondary(t.name);
    const tertiary = (enrich?.tertiary && enrich.tertiary[0]) ? enrich.tertiary[0] : inferTertiary(secondary, t.name);
    const tags = new Set([primary]);
    tags.add(secondary);
    if (tertiary) tags.add(tertiary);
    // Amenity: from mapping if present; else derive for common non-office services
    const isAmenity = (enrich?.amenity === true) || t.tags?.includes('Amenity') || /(cafe|café|coffee|locker|atm|bank|salon|clinic|medical)/i.test(t.name || '');
    if (isAmenity) tags.add('Amenity');
    // Ensure rent psf and totals present
    const landUseRetail = primary === 'Retail (Land Use)';
    const rpsf = t.rentPerSqFt && t.rentPerSqFt > 0 ? t.rentPerSqFt : (landUseRetail ? 60 + Math.round(Math.random() * 70) : 40 + Math.round(Math.random() * 30));
    const monthly = Math.round(rpsf * (t.floorspace || 0));
    return {
      ...t,
      landUse: primary,
      tags: Array.from(tags),
      rentPerSqFt: rpsf,
      monthlyRent: monthly,
      annualRent: monthly * 12,
    };
  });

  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), 'utf8');

  // Also emit a CSV for visibility/editing
  // Extended schema to support stable ids and canonical grouping
  const headers = [
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
    'visitsDaily'
  ];
  const lines = [headers.join(',')];
  for (const t of out) {
    const amenity = t.tags?.includes('Amenity') ? 'Y' : 'N';
    const secondary = t.tags?.find((x) => SECONDARY_TAGS.includes(x)) || '';
    const tertCandidates = (TERTIARY_BY_SECONDARY[secondary] || []);
    const tertiary = (t.tags || []).filter((x) => tertCandidates.includes(x)).join('|');
    lines.push([
      t.id ?? '',
      t.name,
      t.canonicalName || canonicalize(t.name),
      t.location,
      t.floor || '',
      t.country || '',
      amenity,
      (t.landUse?.replace(' (Land Use)', '') || ''),
      secondary,
      tertiary,
      t.floorspace || 0,
      t.rentPerSqFt || 0,
      t.monthlyRent || 0,
      t.annualRent || 0,
      t.leaseYears ?? '',
      t.leaseStart ?? '',
      t.leaseEnd ?? '',
      '',
      '',
      ''
    ].join(','));
  }
  fs.writeFileSync(OUT_CSV, lines.join('\n'), 'utf8');
  console.log(`Demo dataset written: ${OUT_JSON}`);
  console.log(`Demo CSV written: ${OUT_CSV}`);
}

main();


