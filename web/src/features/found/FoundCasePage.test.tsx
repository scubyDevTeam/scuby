// @vitest-environment jsdom
import { parseCase } from '@contracts/case'
import type { FoundCase } from '@contracts/found'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { cases } from '../../mocks/fixtures'
import { renderWithQuery, stubApi } from '../../test-utils'
import { CustodianPanel } from './CustodianPanel'
import { FoundCasePage } from './FoundCasePage'

const now = new Date()

function foundCase(code: string, overrides: Partial<FoundCase> = {}): FoundCase {
  const viewer = overrides.viewer && overrides.viewer !== 'public' ? 'responsible' : 'public'
  const parsed = parseCase(cases(viewer)[code])
  if (parsed.vertical !== 'found') throw new Error('expected a found case')
  return { ...parsed, ...overrides }
}

function show(data: FoundCase, routes: Parameters<typeof stubApi>[0] = {}) {
  const calls = stubApi(routes)
  const onAction = vi.fn()
  const spies = { onConfirmed: vi.fn(), onKeep: vi.fn(), onTransfer: vi.fn() }
  const adoptionLink = <a href="/publicar/adopcion?desde=C4STD">Publicar en adopción</a>
  renderWithQuery(
    <FoundCasePage
      foundCase={data}
      now={now}
      shortUrl="example.test/c/F8UND"
      backLink={<a href="/">Volver</a>}
      mapStyleUrl={undefined}
      onAction={onAction}
      custodianPanel={
        <CustodianPanel foundCase={data} now={now} adoptionLink={adoptionLink} {...spies} />
      }
    />,
  )
  return { calls, onAction, ...spies }
}

describe('FoundCasePage — seen by anyone', () => {
  it('titles the animal by what it looks like and says where it is being kept', () => {
    show(foundCase('F8UND'))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Gato negro, pequeño')
    expect(screen.getByText('Se encontró')).toBeTruthy()
    expect(screen.getByText('Está en casa de quien lo encontró')).toBeTruthy()
  })

  it('offers «Es mío» and never the custodian’s endings', () => {
    const { onAction } = show(foundCase('F8UND'))
    fireEvent.click(screen.getByRole('button', { name: /Es mío/ }))
    expect(onAction).toHaveBeenCalledWith('claim_ownership')
    expect(screen.queryByRole('button', { name: 'Ya está con su dueño' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Me lo quedo' })).toBeNull()
  })

  it('never shows the withheld detail or who is claiming', () => {
    show(foundCase('C4STD', { viewer: 'public' }))
    expect(screen.queryByText(/Collar verde con una campana/)).toBeNull()
    expect(screen.queryByText('Andrés R.')).toBeNull()
    expect(screen.getByText('Posible dueño.')).toBeTruthy()
  })

  it.each([
    ['reunited', 'Ya está con su familia'],
    ['kept', 'Ya tiene hogar'],
    ['transferred_to_org', 'Está con una fundación'],
  ] as const)('a %s case shows «%s» and no actions', (status, label) => {
    show(foundCase('F8UND', { status, resolvedAt: now }))
    expect(screen.getAllByText(new RegExp(label)).length).toBeGreaterThan(0)
    expect(screen.queryAllByRole('button')).toEqual([])
  })
})

describe('FoundCasePage — the custodian (05)', () => {
  const mine = () => foundCase('C4STD', { viewer: 'custodian' })

  it('has the endings of custody', () => {
    const { onAction } = show(mine())
    fireEvent.click(screen.getByRole('button', { name: 'Ya está con su dueño' }))
    expect(onAction).toHaveBeenCalledWith('confirm_reunited')
    expect(screen.queryByRole('button', { name: /Es mío/ })).toBeNull()
  })

  it('sees each claim labelled by its evidence, with the withheld detail and the safety copy', () => {
    show(mine())
    const claims = within(screen.getByRole('region', { name: 'Posibles dueños' }))
    expect(claims.getByText('Andrés R.')).toBeTruthy()
    expect(claims.getByText('Describió algo que no sale en las fotos')).toBeTruthy()
    expect(claims.getByText('Guardaste: «Collar verde con una campana».')).toBeTruthy()
    expect(claims.getByText(/Entrégalo en un lugar público/)).toBeTruthy()
  })

  it('labels a cold claim as such, and a prior lost case as the strongest', () => {
    const base = mine()
    const claim = base.ownershipClaims[0]
    if (!claim) throw new Error('fixture has no claim')
    show({
      ...base,
      ownershipClaims: [
        { ...claim, id: 'a', evidenceNotes: null },
        { ...claim, id: 'b', fromLostCaseCode: '7K3PQ' },
      ],
    })
    expect(screen.getByText('⚠️ Sin evidencia')).toBeTruthy()
    expect(
      screen.getByText('⭐ Publicó un aviso de perdido antes de que lo encontraras'),
    ).toBeTruthy()
  })

  it('confirming a claim records it and moves on to the hand-off', async () => {
    const { calls, onConfirmed } = show(mine(), {
      'POST /cases/C4STD/ownership-claims/own-1': { body: { id: 'own-1' } },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sí, es el dueño' }))
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled())
    expect(calls.at(-1)?.body).toEqual({ status: 'confirmed' })
  })

  it('after 15 days with nobody confirmed, offers a way out — and can re-arm the clock', async () => {
    const { calls, onKeep, onTransfer } = show(mine(), {
      'POST /cases/C4STD/resolve': { body: { id: 'C4STD' } },
    })
    const offer = within(screen.getByRole('region', { name: 'Quince días sin dueño' }))
    fireEvent.click(offer.getByRole('button', { name: 'Me lo quedo' }))
    fireEvent.click(offer.getByRole('button', { name: 'Lo entregué a una fundación' }))
    expect(onKeep).toHaveBeenCalled()
    expect(onTransfer).toHaveBeenCalled()
    // «Publicar en adopción» → the listing form, pre-filled from this case (05 · 06).
    expect(offer.getByRole('link', { name: 'Publicar en adopción' }).getAttribute('href')).toBe(
      '/publicar/adopcion?desde=C4STD',
    )

    fireEvent.click(offer.getByRole('button', { name: 'Sigo buscando al dueño' }))
    await waitFor(() => expect(calls.at(-1)?.body).toMatchObject({ outcome: 'keep_searching' }))
  })

  it('makes no offer before the hold clock is due', () => {
    show(foundCase('F8UND', { viewer: 'custodian' }))
    expect(screen.queryByRole('region', { name: 'Quince días sin dueño' })).toBeNull()
  })
})
