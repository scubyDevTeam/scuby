// Every e2e test has one flow tag and one key of its own (e2e/tags.ts). Reads the test list
// Playwright itself sees, so a test that slips past the `tags()` helper is still caught.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const flows = Object.fromEntries(
  [
    ...readFileSync(new URL('../e2e/tags.ts', import.meta.url), 'utf8').matchAll(
      /'@([a-z0-9-]+)': '([A-Z0-9]+)'/g,
    ),
  ].map(([, flow, prefix]) => [flow, prefix]),
)

const listed = JSON.parse(
  execFileSync('pnpm', ['exec', 'playwright', 'test', '--list', '--reporter=json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }),
)

const tests = []
const walk = (suite) => {
  for (const spec of suite.specs ?? [])
    tests.push({ title: `${spec.file} › ${spec.title}`, tags: spec.tags })
  for (const child of suite.suites ?? []) walk(child)
}
for (const suite of listed.suites) walk(suite)

const problems = []
const keys = new Map()
for (const { title, tags } of tests) {
  const flow = tags.filter((tag) => tag in flows)
  const key = tags.filter((tag) => /^[A-Z][A-Z0-9]*-\d{3}$/.test(tag))
  if (flow.length !== 1)
    problems.push(`${title}: needs exactly one flow tag (${Object.keys(flows).join(', ')})`)
  if (key.length !== 1) problems.push(`${title}: needs exactly one key like FEED-001`)
  if (flow.length === 1 && key.length === 1 && !key[0].startsWith(`${flows[flow[0]]}-`)) {
    problems.push(`${title}: key ${key[0]} does not belong to flow @${flow[0]}`)
  }
  for (const k of key) {
    if (keys.has(k)) problems.push(`${title}: key ${k} is already used by ${keys.get(k)}`)
    keys.set(k, title)
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(`${tests.length} e2e tests, each with its flow and its own key.`)
