// UI copy lives in src/i18n/locales/<lang>.json (docs/eng/frontend.md · Languages). This fails on
// copy written straight into the screens: text between JSX tags, a JSX attribute that reads like a
// sentence, or a string literal with Spanish in it anywhere the app renders from.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const ROOTS = ['src/routes', 'src/features', 'src/ui', 'src/domain', 'src/platform']
const SKIP = /(\.test\.tsx?|\.gen\.ts)$/

// Attributes that are never copy, whatever they hold.
const NOT_COPY = new Set(['className', 'to', 'href', 'src', 'id', 'key', 'type', 'name', 'role'])
// Letters only Spanish copy uses — no identifier, path or class name has them.
const SPANISH = /[áéíóúüñÁÉÍÓÚÜÑ¿¡«»]/
// «Cerrar», «Ver más»: a capitalised word, or anything with a space between letters.
const SENTENCE = /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]|[A-Za-záéíóúñ] [A-Za-záéíóúñ]/
// «Perro», «Lista»: a literal that starts like a word of copy. Tailwind classes and keys are lowercase.
const WORD = /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?=$|[\s.,:;!?…])/
// Words the platform itself spells: DOM key names, GeoJSON types.
const PLATFORM = new Set(['Escape', 'Enter', 'Feature', 'FeatureCollection', 'Point', 'Polygon'])

/** A literal in a place where it is code, not copy: an import, a type, a thrown error. */
function isCode(node) {
  const parent = node.parent
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true
  if (ts.isLiteralTypeNode(parent)) return true
  if (ts.isNewExpression(parent) && parent.expression.getText() === 'Error') return true
  if (ts.isBinaryExpression(parent)) return true
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true
  return PLATFORM.has(node.text)
}

function files(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return files(path)
    return /\.tsx?$/.test(path) && !SKIP.test(path) ? [path] : []
  })
}

const problems = []

for (const file of ROOTS.flatMap(files)) {
  const text = readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const report = (node, what) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart())
    problems.push(`${relative('.', file)}:${line + 1}  ${what}`)
  }

  const visit = (node) => {
    if (ts.isJsxText(node) && /\p{L}/u.test(node.text)) {
      report(node, `text in JSX: «${node.text.trim()}»`)
    } else if (
      ts.isJsxAttribute(node) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    ) {
      const name = node.name.getText()
      const value = node.initializer.text
      if (!NOT_COPY.has(name) && (SPANISH.test(value) || SENTENCE.test(value))) {
        report(node, `${name}="${value}"`)
      }
    } else if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node)) &&
      !ts.isJsxAttribute(node.parent) &&
      !isCode(node) &&
      (SPANISH.test(node.text) || WORD.test(node.text))
    ) {
      report(node, `string: «${node.text}»`)
    } else if (
      ts.isJsxExpression(node) &&
      node.expression &&
      ts.isStringLiteral(node.expression) &&
      /\p{L}/u.test(node.expression.text) &&
      ts.isJsxElement(node.parent)
    ) {
      report(node, `string in JSX: «${node.expression.text}»`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  console.error(
    `\n${problems.length} piece(s) of UI copy written in the code. Add a key to src/i18n/locales/*.json and read it with t().`,
  )
  process.exit(1)
}
console.log('No UI copy outside src/i18n/locales.')
