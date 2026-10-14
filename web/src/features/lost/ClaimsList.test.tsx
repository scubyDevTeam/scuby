// @vitest-environment jsdom
import type { RecoveryClaim } from '@contracts/case'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithQuery, stubApi } from '../../test-utils'
import { ClaimsList } from './ClaimsList'

const now = new Date()
const claim = (id: string, status: RecoveryClaim['status'] = 'open'): RecoveryClaim => ({
  id,
  phone: '+573114829017',
  createdAt: new Date(now.getTime() - 3 * 3_600_000),
  status,
})

function show(claims: RecoveryClaim[], revealsOwnNumber = false) {
  const calls = stubApi({ 'POST /cases/7K3PQ/claims/c1': { body: { id: 'c1' } } })
  const onConfirmed = vi.fn()
  renderWithQuery(
    <ClaimsList
      code="7K3PQ"
      petName="Luna"
      claims={claims}
      now={now}
      revealsOwnNumber={revealsOwnNumber}
      onConfirmed={onConfirmed}
    />,
  )
  return { calls, onConfirmed }
}

describe('ClaimsList — 04 · the owner owes the claim an answer', () => {
  it('confirming a claim records it and moves on to closing the case', async () => {
    const { calls, onConfirmed } = show([claim('c1')])
    fireEvent.click(screen.getByRole('button', { name: 'Sí, es Luna' }))

    await waitFor(() => expect(onConfirmed).toHaveBeenCalled())
    expect(calls.at(-1)).toEqual({
      key: 'POST /cases/7K3PQ/claims/c1',
      body: { status: 'confirmed' },
    })
  })

  it('dismissing a claim records it and closes nothing', async () => {
    const { calls, onConfirmed } = show([claim('c1')])
    fireEvent.click(screen.getByRole('button', { name: 'No era' }))

    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ status: 'dismissed' }))
    expect(onConfirmed).not.toHaveBeenCalled()
  })

  it('shows only claims still waiting for an answer', () => {
    show([claim('c1', 'dismissed'), claim('c2', 'stale')])
    expect(screen.queryByRole('region', { name: 'Posibles hallazgos' })).toBeNull()
  })

  it('warns an in-app-only owner that writing reveals their own number (auth.md)', () => {
    show([claim('c1')], true)
    expect(screen.getByText('Al escribirle, esa persona verá tu número.')).toBeTruthy()
  })

  it('does not warn an owner whose number is already public', () => {
    show([claim('c1')])
    expect(screen.queryByText('Al escribirle, esa persona verá tu número.')).toBeNull()
  })
})
