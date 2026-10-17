// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InboxTabs } from './InboxTabs'

const tabLink = (tab: string, children: React.ReactNode, className: string) => (
  <a key={tab} href={`/bandeja?tab=${tab}`} className={className}>
    {children}
  </a>
)

describe('InboxTabs — Avisos · Mensajes', () => {
  it('links both halves of the inbox', () => {
    render(<InboxTabs current="notices" tabLink={tabLink} />)
    expect(screen.getByRole('link', { name: 'Avisos' }).getAttribute('href')).toBe(
      '/bandeja?tab=notices',
    )
    expect(screen.getByRole('link', { name: 'Mensajes' }).getAttribute('href')).toBe(
      '/bandeja?tab=messages',
    )
  })

  it('marks the current one apart', () => {
    render(<InboxTabs current="messages" tabLink={tabLink} />)
    expect(screen.getByRole('link', { name: 'Mensajes' }).className).toContain('bg-surface')
    expect(screen.getByRole('link', { name: 'Avisos' }).className).not.toContain('bg-surface')
  })
})
