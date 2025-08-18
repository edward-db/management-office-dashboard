import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = path.join(ROOT, 'public', 'data')
const SRC_JSON = path.join(DATA_DIR, 'tenants_demo.json')
const OUT_CSV = path.join(DATA_DIR, 'tenants_demo_for_tagging.csv')

// Expanded secondaries and tertiaries to match the app and CSV contents
const SECONDARY_TAGS = [
  'F&B',
  'Retail and Convenience',
  'Third Space',
  'Fitness',
  'Healthcare',
  'Business Community and Social Spaces',
  'Trade Categories',
]

const TERTIARY_BY_SECONDARY = {
  'F&B': ['Café', 'Restaurant', 'Bakery', 'Grab and Go', 'Food Hall', 'Bar'],
  'Retail and Convenience': ['Banking', 'Beauty', 'Health', 'Fashion (Shopping)', 'Smart Locker'],
  'Third Space': ["Event Space", "Member's Club", 'Co-working spaces'],
  Fitness: ['Golf', 'Gym', 'Movement Studio', 'Yoga Studio', 'Physiotherapy'],
  Healthcare: ['Dental Clinic', 'Medical Clinic', 'Physiotherapy'],
  'Business Community and Social Spaces': ['Event Space'],
  'Trade Categories': [
    'Banking and Financial Services',
    'Technology Media and Telecoms (TMT)',
    'Insurance',
    'Real Estate and Construction',
    'Fashion/Retail',
    'Media',
    'Professional and Business Services',
    'Manufacturing',
    'Marketing',
    'Biotech/Pharmaceutical/Healthcare Products',
    'Holdings',
    'Government',
    'Sourcing and Trading',
    'Logistics (Airlines/Shipping/Transportation/Couriers)',
    'Legal Services',
    'Hotels/Travel Agency',
  ],
}

function canonicalize(name) {
  return String(name || '')
    .replace(/\[.*?\]/g, '')
    .replace(/\b(limited|ltd|co\.?|company)\b/gi, '')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
}

function serializeMonthNumberPairs(arr, key) {
  if (!Array.isArray(arr) || !arr.length) return ''
  return arr.map(r => `${r.month}:${Number(r[key] || 0)}`).join(';')
}

function serializeDateNumberPairs(arr, key) {
  if (!Array.isArray(arr) || !arr.length) return ''
  return arr.map(r => `${r.date}:${Number(r[key] || 0)}`).join(';')
}

function main() {
  if (!fs.existsSync(SRC_JSON)) {
    console.error(`Source not found: ${SRC_JSON}`)
    process.exit(1)
  }
  const tenants = JSON.parse(fs.readFileSync(SRC_JSON, 'utf8'))

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
    'visitsDaily',
  ]

  const lines = [headers.join(',')]
  for (const t of tenants) {
    const amenity = Array.isArray(t.tags) && t.tags.includes('Amenity') ? 'Y' : 'N'
    const secondary = (Array.isArray(t.tags) ? t.tags.find(x => SECONDARY_TAGS.includes(x)) : '') || ''
    // Export all non-primary, non-secondary tags as tertiary; don't drop unknowns
    const tertiary = (Array.isArray(t.tags)
      ? t.tags.filter(x => x && !x.endsWith(' (Land Use)') && x !== 'Amenity' && x !== secondary)
      : []
    ).join('|')
    const primary = String(t.landUse || '').replace(' (Land Use)', '')
    const salesMonthly = serializeMonthNumberPairs(t.salesMonthly, 'sales')
    const membershipsMonthly = serializeMonthNumberPairs(t.membershipsMonthly, 'members')
    const visitsDaily = serializeDateNumberPairs(t.visitsDaily, 'visits')

    lines.push([
      t.id ?? '',
      t.name ?? '',
      t.canonicalName || canonicalize(t.name ?? ''),
      t.location ?? '',
      t.floor ?? '',
      t.country ?? '',
      amenity,
      primary,
      secondary,
      tertiary,
      t.floorspace ?? 0,
      t.rentPerSqFt ?? 0,
      t.monthlyRent ?? 0,
      t.annualRent ?? 0,
      t.leaseYears ?? '',
      t.leaseStart ?? '',
      t.leaseEnd ?? '',
      salesMonthly,
      membershipsMonthly,
      visitsDaily,
    ].join(','))
  }

  fs.writeFileSync(OUT_CSV, lines.join('\n'), 'utf8')
  console.log(`Exported CSV: ${OUT_CSV}`)
}

main()


