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

// Expand a floor string into discrete floor labels
function expandFloors(input) {
  const out = []
  const s = String(input || '').trim()
  if (!s) return out
  const parts = s.split(/[;,]+/).flatMap(p => p.split(/\s{2,}/)).map((p) => p.trim()).filter(Boolean)
  const normalizeToken = (tok) => {
    const m = tok.match(/(LG|UG|G)\/?\s*[fF]?/) || tok.match(/(B\d+)\/?\s*[fF]?/) || tok.match(/(\d+)\s*\/?\s*[fF]?/)
    if (!m) return tok
    const raw = m[1]
    if (/^(LG|UG|G)$/i.test(raw)) return `${raw.toUpperCase()}`.replace('G', 'G/F')
    if (/^B\d+$/i.test(raw)) return raw.toUpperCase()
    const n = Number(raw)
    return Number.isFinite(n) ? `${n}/F` : tok
  }
  for (const part of parts) {
    const range = part.match(/(\d+)\s*\/?\s*[fF]?\s*[-–to]+\s*(\d+)\s*\/?\s*[fF]?/i)
    if (range) {
      const a = Number(range[1])
      const b = Number(range[2])
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const [start, end] = a <= b ? [a, b] : [b, a]
        for (let i = start; i <= end; i++) out.push(`${i}/F`)
        continue
      }
    }
    // Also split on single commas in the floor token list
    const commaSplit = part.split(',').map(t => t.trim()).filter(Boolean)
    for (const tok of commaSplit) out.push(normalizeToken(tok))
  }
  return out.filter(Boolean)
}

function toNumberOrEmpty(token) {
  const s = String(token || '').replace(/,/g, '').trim()
  if (s === '') return ''
  const n = Number(s)
  return Number.isFinite(n) ? n : ''
}

function main() {
  if (!fs.existsSync(SRC_FILE)) {
    console.error(`CSV not found: ${SRC_FILE}`)
    process.exit(1)
  }
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(BACKUP_DIR, `tenants_demo_for_tagging.csv.fullclean-${ts}.bak`)
  fs.copyFileSync(SRC_FILE, backupPath)

  const raw = fs.readFileSync(SRC_FILE, 'utf8')
  const lines = raw.split('\n').filter((l) => l.trim() !== '')
  if (lines.length < 2) {
    console.log('CSV appears empty; nothing to clean')
    return
  }

  const header = parseCSVLine(lines[0])
  if (header.length !== 11 || header[0].toLowerCase() !== 'name') {
    console.log('This cleaner expects the short 11-column schema; no change made.')
    return
  }

  const outLines = [header.join(',')]
  let expandedCount = 0
  function isNumericLike(token) {
    const s = String(token || '').trim()
    if (!s) return false
    return /^-?\d+(?:\.\d+)?$/.test(s) || /^[\d,]+(?:\.\d+)?$/.test(s)
  }

  function recoverShortRowFlexible(cols) {
    // Attempt to recover 11 logical fields from arbitrarily split cols
    if (cols.length < 7) return null
    // Identify the last 4 numeric-like tokens (floorspace, rpsf, monthly, annual)
    let tailStart = -1
    for (let i = cols.length - 4; i >= 4; i--) {
      const maybe = cols.slice(i, i + 4)
      if (maybe.length === 4 && maybe.every(isNumericLike)) {
        tailStart = i
        break
      }
    }
    if (tailStart === -1) return null
    const head = cols.slice(0, tailStart)
    const tail = cols.slice(tailStart)
    const name = head[0] || ''
    const building = head[1] || ''
    // Find amenity token (Y/N/Yes/No/True/False/1/0/X)
    let amenityIdx = -1
    for (let i = 2; i < head.length; i++) {
      const v = String(head[i] || '').trim().toLowerCase()
      if (['y','yes','true','1','x','n','no','false','0'].includes(v)) { amenityIdx = i; break }
    }
    // If not found, assume floor is only one token at index 2
    let floorStr = head[2] || ''
    let amenity = ''
    let primary = ''
    let secondary = ''
    let tertiary = ''
    if (amenityIdx !== -1) {
      // floor is everything between index 2 and amenityIdx (exclusive)
      floorStr = head.slice(2, amenityIdx).join(',')
      amenity = head[amenityIdx] || ''
      primary = head[amenityIdx + 1] || ''
      secondary = head[amenityIdx + 2] || ''
      tertiary = head.slice(amenityIdx + 3).join('|')
    } else {
      // fallback to best-effort
      amenity = head[3] || ''
      primary = head[4] || ''
      secondary = head[5] || ''
      tertiary = head.slice(6).join('|')
    }
    const [floorspace, rentPerSqFt, monthlyRent, annualRent] = tail
    return [name, building, floorStr, amenity, primary, secondary, tertiary, floorspace, rentPerSqFt, monthlyRent, annualRent]
  }

  for (let i = 1; i < lines.length; i++) {
    const rawCols = parseCSVLine(lines[i])
    let cols = rawCols
    if (cols.length !== 11) {
      const recovered = recoverShortRowFlexible(cols)
      if (recovered) cols = recovered
    }
    if (cols.length !== 11) {
      // keep as-is if unrecoverable
      outLines.push(rawCols.map(csvEscape).join(','))
      continue
    }
    const [name, building, floorStr, amenity, primary, secondary, tertiary, floorspace, rentPerSqFt, monthlyRent, annualRent] = cols

    const floorsList = expandFloors(floorStr)
    if (floorsList.length <= 1) {
      outLines.push([name, building, floorStr, amenity, primary, secondary, tertiary, floorspace, rentPerSqFt, monthlyRent, annualRent].map(csvEscape).join(','))
      continue
    }

    // Split evenly; last row gets remainder
    const count = floorsList.length
    const fsNum = toNumberOrEmpty(floorspace)
    const mrNum = toNumberOrEmpty(monthlyRent)
    const arNum = toNumberOrEmpty(annualRent)
    const rpsfNum = toNumberOrEmpty(rentPerSqFt)

    let perFs = Array(count).fill('')
    let perMr = Array(count).fill('')
    let perAr = Array(count).fill('')
    if (typeof fsNum === 'number' && fsNum > 0) {
      const each = Math.floor((fsNum / count) * 100) / 100
      perFs = floorsList.map(() => each)
      perFs[perFs.length - 1] = Number((fsNum - each * (count - 1)).toFixed(2))
    }
    if (typeof mrNum === 'number' && mrNum > 0) {
      const each = Math.round(mrNum / count)
      perMr = floorsList.map(() => each)
      perMr[perMr.length - 1] = mrNum - each * (count - 1)
    }
    if (typeof arNum === 'number' && arNum > 0) {
      const each = Math.round(arNum / count)
      perAr = floorsList.map(() => each)
      perAr[perAr.length - 1] = arNum - each * (count - 1)
    }

    for (let idx = 0; idx < floorsList.length; idx++) {
      outLines.push([
        name,
        building,
        floorsList[idx],
        amenity,
        primary,
        secondary,
        tertiary,
        perFs[idx] !== '' ? String(perFs[idx]) : floorspace,
        rpsfNum !== '' ? String(rpsfNum) : rentPerSqFt,
        perMr[idx] !== '' ? String(perMr[idx]) : monthlyRent,
        perAr[idx] !== '' ? String(perAr[idx]) : annualRent,
      ].map(csvEscape).join(','))
    }
    expandedCount++
  }

  fs.writeFileSync(SRC_FILE, outLines.join('\n'), 'utf8')
  console.log(`Expanded ${expandedCount} multi-floor row(s) into separate rows.`)
  console.log(`Clean CSV written: ${SRC_FILE}`)
  console.log(`Backup saved to: ${backupPath}`)
}

try {
  main()
} catch (err) {
  console.error(err)
  process.exit(1)
}


