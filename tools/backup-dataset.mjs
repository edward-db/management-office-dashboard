import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = path.join(ROOT, 'public', 'data')
const SRC = path.join(DATA_DIR, 'tenants_demo.json')

function ts() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`Source dataset not found: ${SRC}`)
    process.exit(1)
  }
  const backupDir = path.join(DATA_DIR, 'backups')
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })
  const dest = path.join(backupDir, `tenants_demo.${ts()}.json`)
  fs.copyFileSync(SRC, dest)
  console.log(`Backup written: ${dest}`)
}

main()


