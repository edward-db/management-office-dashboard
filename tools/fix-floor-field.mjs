import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = path.join(ROOT, 'public', 'data')
const SRC_FILE = path.join(DATA_DIR, 'tenants_demo_for_tagging.csv')
const BACKUP_DIR = path.join(DATA_DIR, 'backups')

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
  return result.map((s) => s.trim())
}

function csvEscape(value) {
  const s = String(value ?? '')
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes(';') || s.includes(':')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

function main() {
  if (!fs.existsSync(SRC_FILE)) {
    console.error(`CSV not found: ${SRC_FILE}`)
    process.exit(1)
  }
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(BACKUP_DIR, `tenants_demo_for_tagging.csv.clean-${ts}.bak`)
  fs.copyFileSync(SRC_FILE, backupPath)

  const raw = fs.readFileSync(SRC_FILE, 'utf8')
  const lines = raw.split('\n')
  if (lines.length < 2) {
    console.log('CSV appears empty; nothing to fix')
    return
  }
  const header = parseCSVLine(lines[0])
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]))

  const isShort = header.length === 11 && header[0].toLowerCase() === 'name'
  const isExtended = header.length >= 19 && header[0].toLowerCase() === 'id'
  if (!isShort && !isExtended) {
    console.log('CSV header not recognized; no change made.')
    return
  }

  const out = [header.join(',')]
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') continue
    const cols = parseCSVLine(line)
    if (cols.length < header.length) {
      // likely due to unescaped commas; attempt recovery by rejoining until tail size matches
      // fallback to joining everything except known numeric tail for short schema is handled in sync tool
    }
    const floorIndex = idx['floor']
    if (typeof floorIndex === 'number' && floorIndex >= 0 && floorIndex < cols.length) {
      cols[floorIndex] = cols[floorIndex].replace(/\s*,\s*/g, ', ')
    }
    // Escape all fields to ensure commas in floor are quoted
    out.push(cols.map(csvEscape).join(','))
  }

  fs.writeFileSync(SRC_FILE, out.join('\n'), 'utf8')
  console.log(`CSV cleaned and written: ${SRC_FILE}`)
  console.log(`Backup created at: ${backupPath}`)
}

try {
  main()
} catch (err) {
  console.error(err)
  process.exit(1)
}


