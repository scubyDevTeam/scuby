/// <reference types="node" />
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { api } from './api'
import { openApiDocument } from './openapi'

const FILE = fileURLToPath(new URL('../../../docs/eng/openapi.json', import.meta.url))

describe('the OpenAPI document', () => {
  const generated = `${JSON.stringify(openApiDocument(), null, 2)}\n`

  it('is the one api.ts generates — run `pnpm openapi` after changing the contract', () => {
    if (process.env.UPDATE_OPENAPI) writeFileSync(FILE, generated)
    expect(readFileSync(FILE, 'utf8')).toBe(generated)
  })

  it('has one operation per endpoint, and no two endpoints share a method and path', () => {
    const keys = Object.values(api).map((e) => `${e.method} ${e.path}`)
    expect(new Set(keys).size).toBe(keys.length)
    const operations = Object.values(openApiDocument().paths).flatMap((ops) => Object.keys(ops))
    expect(operations).toHaveLength(keys.length)
  })
})
