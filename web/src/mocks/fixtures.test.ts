import { describe, expect, it } from 'vitest'
import { parseCase } from '../contracts/case'
import { parseFeed } from '../contracts/feed'
import { cases, feedItems } from './fixtures'

describe('fixtures speak the contract', () => {
  it.each(Object.keys(cases()))('case %s parses', (code) => {
    expect(parseCase(cases()[code]).code).toBe(code)
  })

  it('cover every status of a lost case', () => {
    const statuses = Object.values(cases()).flatMap((c) =>
      c.vertical === 'lost' ? [c.status] : [],
    )
    expect(new Set(statuses)).toEqual(new Set(['active', 'reunited', 'expired', 'cancelled']))
  })

  it('the feed parses and every card resolves to a case', () => {
    const feed = parseFeed({ scope: 'local', items: feedItems() })
    for (const item of feed.items) expect(cases()[item.code]).toBeDefined()
  })
})
