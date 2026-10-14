// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PublishDoors } from './PublishDoors'

describe('PublishDoors — 04 · only the owner publishes a lost case', () => {
  it('offers the four doors, each leading to its own flow', () => {
    render(<PublishDoors link={(door, children) => <a href={`/${door}`}>{children}</a>} />)
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/lost', '/found', '/adoption', '/help'])
  })

  it('sends someone who only saw an animal through «Encontré un animal»', () => {
    render(<PublishDoors link={(_, children) => <a href="/x">{children}</a>} />)
    expect(screen.getByText('¿Solo viste un animal en la calle?')).toBeTruthy()
  })
})
