import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const DATA_DIR = path.join(ROOT, 'public', 'data')
const SRC = path.join(DATA_DIR, 'tenants_demo.json')

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }

function generateRetailSales(tenant) {
  const monthsBack = 24
  const today = new Date()
  const landUseRetail = String(tenant.landUse || '').includes('Retail')
  const baseRpsf = Number(tenant.rentPerSqFt || (landUseRetail ? randInt(60, 120) : randInt(40, 70)))
  const floorspace = Number(tenant.floorspace || 0)
  const factor = 16 + Math.random() * 10
  const base = floorspace * baseRpsf * factor
  const trend = (Math.random() - 0.5) * 0.1
  const out = []
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const m = d.getMonth()
    const season = 1 + (m === 11 ? 0.2 : m === 0 ? 0.08 : m >= 5 && m <= 7 ? -0.06 : 0)
    const t = 1 + trend * ((monthsBack - 1 - i) / (monthsBack - 1))
    const noise = 1 + (Math.random() - 0.5) * 0.1
    const sales = Math.max(0, Math.round(base * season * t * noise))
    out.push({ month: ym, sales })
  }
  const byYear = new Map()
  for (const r of out) {
    const y = r.month.slice(0, 4)
    byYear.set(y, (byYear.get(y) || 0) + r.sales)
  }
  const salesByYear = Array.from(byYear.entries()).map(([year, sales]) => ({ year, sales }))
  return { salesMonthly: out, salesByYear }
}

function generateEngagementSeries() {
  // Memberships by month and daily visits for ~90 days
  const monthsBack = 24
  const today = new Date()
  const membershipsMonthly = []
  const baseMembers = 200 + Math.round(Math.random() * 1800)
  const trend = (Math.random() - 0.5) * 0.15
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const season = 1 + ((d.getMonth() === 0 || d.getMonth() === 8) ? 0.06 : (d.getMonth() === 6 ? -0.05 : 0))
    const t = 1 + trend * ((monthsBack - 1 - i) / (monthsBack - 1))
    const noise = 1 + (Math.random() - 0.5) * 0.08
    const members = Math.max(0, Math.round(baseMembers * season * t * noise))
    membershipsMonthly.push({ month: ym, members })
  }

  const days = 90
  const visitsDaily = []
  let day = new Date(today)
  day.setDate(day.getDate() - (days - 1))
  const baseVisits = 80 + Math.round(Math.random() * 600)
  for (let i = 0; i < days; i++) {
    const isWeekend = day.getDay() === 0 || day.getDay() === 6
    const season = isWeekend ? 0.8 : 1.0
    const noise = 1 + (Math.random() - 0.5) * 0.15
    visitsDaily.push({ date: day.toISOString().slice(0, 10), visits: Math.max(0, Math.round(baseVisits * season * noise)) })
    day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
  }
  return { membershipsMonthly, visitsDaily }
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`Source not found: ${SRC}`)
    process.exit(1)
  }
  const tenants = JSON.parse(fs.readFileSync(SRC, 'utf8'))

  let updated = 0
  for (const t of tenants) {
    const tags = Array.isArray(t.tags) ? t.tags : []
    const secondary = tags.find(x => ['F&B', 'Retail and Convenience', 'Third Space', 'Fitness'].includes(x)) || ''

    if ((secondary === 'F&B' || secondary === 'Retail and Convenience')) {
      const hasSales = Array.isArray(t.salesMonthly) && t.salesMonthly.length > 0
      if (!hasSales) {
        const { salesMonthly, salesByYear } = generateRetailSales(t)
        t.salesMonthly = salesMonthly
        t.salesByYear = salesByYear
        updated++
      }
    }

    if (secondary === 'Third Space' || secondary === 'Fitness') {
      const hasEngagement = (Array.isArray(t.membershipsMonthly) && t.membershipsMonthly.length > 0) || (Array.isArray(t.visitsDaily) && t.visitsDaily.length > 0)
      if (!hasEngagement) {
        const { membershipsMonthly, visitsDaily } = generateEngagementSeries()
        t.membershipsMonthly = membershipsMonthly
        t.visitsDaily = visitsDaily
        // also derive monthly/annual aggregations if needed elsewhere can be computed on read
        updated++
      }
    }
  }

  fs.writeFileSync(SRC, JSON.stringify(tenants, null, 2), 'utf8')
  console.log(`Enriched ${updated} tenants with synthetic time-series in ${SRC}`)
}

main()


