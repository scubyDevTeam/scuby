// @vitest-environment jsdom
import type { AdoptionCase } from '@contracts/adoption'
import { parseCase } from '@contracts/case'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { cases } from '../../mocks/fixtures'
import { renderWithQuery, stubApi } from '../../test-utils'
import { RecordAdoptionForm, WithdrawListingForm } from './ListerForms'

const misha = () => {
  const parsed = parseCase(cases('responsible').M1SHI)
  if (parsed.vertical !== 'adoption') throw new Error('adoption')
  return parsed
}

function record(listing: AdoptionCase) {
  const calls = stubApi({ 'POST /cases/M1SHI/adopt': { body: { id: 'M1SHI' } } })
  const onDone = vi.fn()
  renderWithQuery(<RecordAdoptionForm listing={listing} onDone={onDone} />)
  return { calls, onDone }
}

describe('06 · Record adoption — «¿Quién lo adoptó?»', () => {
  it('picks from the list: the responsibility moves to that person', async () => {
    const { calls, onDone } = record(misha())
    fireEvent.click(screen.getByLabelText('Julián R.'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar adopción' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(calls.at(-1)?.body).toEqual({ interest_id: 'int-misha-julian' })
  })

  it('or «fuera de la app», recorded as what it is', async () => {
    const { calls } = record(misha())
    fireEvent.click(screen.getByLabelText('Alguien fuera de la app'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar adopción' }))
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ interest_id: null }))
  })

  it('suggests the chosen person, and asks for a choice before sending', () => {
    const base = misha()
    const { calls } = record({
      ...base,
      interests: base.interests.map((i) => ({ ...i, status: 'open' as const })),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar adopción' }))
    expect(screen.getByText('Elige una opción')).toBeTruthy()
    expect(calls.filter((c) => c.key.startsWith('POST'))).toEqual([])
  })
})

describe('06 · withdrawn — one exit, with its reason', () => {
  it('sends the reason', async () => {
    const calls = stubApi({ 'POST /cases/M1SHI/withdraw': { body: { id: 'M1SHI' } } })
    renderWithQuery(<WithdrawListingForm code="M1SHI" onDone={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Falleció'))
    fireEvent.click(screen.getByRole('button', { name: 'Retirar publicación' }))
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ resolution: 'deceased' }))
  })
})
