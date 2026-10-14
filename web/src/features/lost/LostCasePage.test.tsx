// @vitest-environment jsdom
import { type LostCase, parseCase } from '@contracts/case'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { cases } from '../../mocks/fixtures'
import { LostCasePage } from './LostCasePage'

const now = new Date()

function lostCase(code: string, overrides: Partial<LostCase> = {}): LostCase {
  const parsed = parseCase(cases()[code])
  if (parsed.vertical !== 'lost') throw new Error('expected a lost case')
  return { ...parsed, ...overrides }
}

function show(caseData: LostCase) {
  const onAction = vi.fn()
  render(
    <LostCasePage
      lostCase={caseData}
      now={now}
      shortUrl="example.test/c/7K3PQ"
      backLink={<a href="/">Volver</a>}
      onAction={onAction}
    />,
  )
  return onAction
}

describe('LostCasePage — active case, seen by a helper', () => {
  it('offers the sighting and the claim, and reports which one was tapped', () => {
    const onAction = show(lostCase('7K3PQ'))

    fireEvent.click(screen.getByRole('button', { name: /La vi/ }))
    fireEvent.click(screen.getByRole('button', { name: 'La tengo conmigo' }))

    expect(onAction.mock.calls).toEqual([['report_sighting'], ['claim_recovery']])
  })

  it('shows the possible-find badge while a claim is open, and keeps the actions', () => {
    show(lostCase('7K3PQ'))
    expect(screen.getByText('Posible hallazgo.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /La vi/ })).toBeTruthy()
  })

  it('lists sightings newest first, numbered from the oldest', () => {
    show(lostCase('7K3PQ'))
    const items = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(items.map((item) => item.textContent?.[0])).toEqual(['3', '2', '1'])
  })

  it('never offers a helper the owner-only close', () => {
    show(lostCase('7K3PQ'))
    expect(screen.queryByRole('button', { name: 'Ya apareció' })).toBeNull()
  })

  it('links to WhatsApp only when the owner exposed it', () => {
    show(lostCase('7K3PQ', { contact: { displayName: 'Carolina M.', whatsappUrl: null } }))
    expect(screen.getByText('Carolina M.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Escribirle por WhatsApp' })).toBeNull()
  })
})

describe('LostCasePage — the owner', () => {
  it('can close an active case as reunited', () => {
    const onAction = show(lostCase('7K3PQ', { viewer: 'owner' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ya apareció' }))
    expect(onAction).toHaveBeenCalledWith('confirm_reunited')
    expect(screen.queryByRole('button', { name: /La vi/ })).toBeNull()
  })

  it('can reopen an archived case', () => {
    const onAction = show(lostCase('ARCH2', { viewer: 'owner' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reactivar aviso' }))
    expect(onAction).toHaveBeenCalledWith('reopen')
  })
})

describe('LostCasePage — closed cases (10 §1)', () => {
  it('a reunited case shows the banner and no actions', () => {
    show(lostCase('H4PPY'))
    expect(screen.getByText('¡Toby ya está en casa!')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('an archived case says so and offers a helper nothing', () => {
    show(lostCase('ARCH2'))
    expect(screen.getByText('Este aviso fue archivado.')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toEqual([])
  })
})
