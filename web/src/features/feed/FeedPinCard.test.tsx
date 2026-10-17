// @vitest-environment jsdom
import { parseFeed } from '@contracts/feed'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { feedItems } from '../../mocks/fixtures'
import { FeedPinCard } from './FeedPinCard'

describe('FeedPinCard', () => {
  it('shows what the pin is — badge, name, place and time — and links to its case', () => {
    const items = parseFeed({ scope: 'local', items: feedItems() }).items
    const luna = items.find((item) => item.code === '7K3PQ')!
    render(
      <FeedPinCard
        item={luna}
        now={new Date()}
        link={(children) => <a href={`/c/${luna.code}`}>{children}</a>}
      />,
    )
    expect(screen.getByText('Se busca')).toBeTruthy()
    expect(screen.getByRole('heading', { name: luna.title })).toBeTruthy()
    expect(screen.getByText(new RegExp(`^${luna.placeName} · `))).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ver' }).getAttribute('href')).toBe('/c/7K3PQ')
  })
})
