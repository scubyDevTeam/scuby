// The budget of docs/eng/frontend.md · Budgets: JS a stranger downloads to see /c/:code for the
// first time, gzipped, map excluded (it is lazy and loads after the page is readable).
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const BUDGET_KB = 150
// Every screen hangs from the optional language segment (docs/eng/frontend.md · Languages).
const ROUTE = '{-$locale}/c.$code'

const manifest = JSON.parse(readFileSync('dist/.vite/manifest.json', 'utf8'))
const entries = Object.entries(manifest)
// The route loads one vertical's screen on demand; the lost page is the one a shared link opens most.
const SCREEN = 'routes/{-$locale}/-case/LostCaseScreen.tsx'
const starts = entries.filter(
  ([key, chunk]) => chunk.isEntry || key.includes(`routes/${ROUTE}.tsx`) || key.includes(SCREEN),
)
if (starts.length < 3) {
  console.error(
    `Could not find the entry, the ${ROUTE} route and its lost screen in the build manifest.`,
  )
  process.exit(1)
}

// Static imports only: dynamic ones (the map, the mock worker) are not part of the first load.
const needed = new Set()
const visit = (key) => {
  if (needed.has(key)) return
  needed.add(key)
  for (const next of manifest[key].imports ?? []) visit(next)
}
for (const [key] of starts) visit(key)

let total = 0
for (const key of needed) {
  const file = manifest[key].file
  if (!file.endsWith('.js')) continue
  const size = gzipSync(readFileSync(`dist/${file}`)).length
  total += size
  console.log(`${(size / 1024).toFixed(1).padStart(7)} kB  ${file}`)
}
const kb = total / 1024
console.log(`${kb.toFixed(1).padStart(7)} kB  first load of /c/:code (budget ${BUDGET_KB} kB)`)
if (kb > BUDGET_KB) {
  console.error('Over budget.')
  process.exit(1)
}
