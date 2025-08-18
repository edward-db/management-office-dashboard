import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = path.join(ROOT, 'public', 'data')
const CSV_FILE = path.join(DATA_DIR, 'tenants_demo_for_tagging.csv')

function parseCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result.map(s => s.trim())
}

function warn(msg) {
  console.warn(`WARN: ${msg}`)
}

function main() {
  if (!fs.existsSync(CSV_FILE)) {
    console.error(`CSV not found: ${CSV_FILE}`)
    process.exit(1)
  }
  const content = fs.readFileSync(CSV_FILE, 'utf8')
  const lines = content.split('\n').filter(l => l.trim())
  if (lines.length < 2) {
    console.log('CSV appears empty, nothing to validate')
    return
  }
  const headers = parseCSVLine(lines[0])
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]))

  const get = (vals, key) => vals[idx[key]] ?? ''

  let warnings = 0
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i])
    const name = get(row, 'name')
    const building = get(row, 'building')
    const primary = (get(row, 'primary') || '').trim()
    const secondary = (get(row, 'secondary') || '').trim()
    const salesMonthly = (get(row, 'salesMonthly') || '').trim()
    const membershipsMonthly = (get(row, 'membershipsMonthly') || '').trim()
    const visitsDaily = (get(row, 'visitsDaily') || '').trim()

    const idLabel = `${name || '(no name)'} | ${building || '(no building)'} (line ${i + 1})`

    // Retail & F&B → expect sales, engagement optional
    if (secondary === 'F&B' || secondary === 'Retail and Convenience') {
      if (!salesMonthly) {
        warn(`${idLabel}: Secondary='${secondary}' usually requires salesMonthly; field is empty`)
        warnings++
      }
    }
    // Third Space & Fitness → expect engagement, sales optional
    if (secondary === 'Third Space' || secondary === 'Fitness') {
      if (!membershipsMonthly && !visitsDaily) {
        warn(`${idLabel}: Secondary='${secondary}' usually requires membershipsMonthly or visitsDaily; both are empty`)
        warnings++
      }
    }
  }

  if (warnings === 0) {
    console.log('CSV validation passed with no warnings')
  } else {
    console.log(`CSV validation completed with ${warnings} warning(s)`) 
  }
}

main()


