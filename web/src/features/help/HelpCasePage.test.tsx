// @vitest-environment jsdom
import { parseCase } from '@contracts/case'
import type { HelpCase } from '@contracts/help-case'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { cases } from '../../mocks/fixtures'
import { renderWithQuery, stubApi } from '../../test-utils'
import { BeneficiaryPanel } from './BeneficiaryPanel'
import { HelpCasePage } from './HelpCasePage'

const now = new Date()

function request(code: string, overrides: Partial<HelpCase> = {}): HelpCase {
  const viewer = overrides.viewer === 'beneficiary' ? 'responsible' : 'public'
  const parsed = parseCase(cases(viewer)[code])
  if (parsed.vertical !== 'help') throw new Error('expected a help request')
  return { ...parsed, ...overrides }
}

function show(data: HelpCase, routes: Parameters<typeof stubApi>[0] = {}) {
  const calls = stubApi(routes)
  const spies = { onAction: vi.fn(), onOffer: vi.fn(), onWithdrawPledge: vi.fn(), onClose: vi.fn() }
  renderWithQuery(
    <HelpCasePage
      request={data}
      now={now}
      shortUrl="example.test/c/HE7PA"
      backLink={<a href="/">Volver</a>}
      mapStyleUrl={undefined}
      onAction={spies.onAction}
      onOffer={spies.onOffer}
      onWithdrawPledge={spies.onWithdrawPledge}
      beneficiaryPanel={<BeneficiaryPanel request={data} now={now} onClose={spies.onClose} />}
    />,
  )
  return { calls, ...spies }
}

const need = (name: string) =>
  within(
    within(screen.getByRole('list', { name: 'Lo que necesita' })).getByRole('listitem', { name }),
  )

describe('HelpCasePage — seen by anyone (07)', () => {
  it('says who asks, honestly labelled, and that no money is ever asked', () => {
    show(request('HE7PA'))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Max')
    expect(screen.getByText('Lo pide Julián R.')).toBeTruthy()
    expect(
      screen.getByText('Sin verificar — la plataforma no ha revisado quién pide.'),
    ).toBeTruthy()
    expect(screen.getByText(/nadie te va a pedir dinero/)).toBeTruthy()
  })

  it('shows each need with what it asks and its progress: confirmed first, promised second', () => {
    show(request('HE7PA'))
    expect(need('Hogar temporal').getByText('Nadie se ha ofrecido todavía.')).toBeTruthy()
    expect(need('Transporte').getByText('0 de 1 confirmado · 1 prometido')).toBeTruthy()
    expect(need('Transporte').getByText(/^Para el /)).toBeTruthy()
    expect(need('Insumos').getByText('2 confirmado · 0 prometido')).toBeTruthy()
  })

  it('«Yo ayudo» is offered on each need, for that need', () => {
    const { onOffer } = show(request('HE7PA'))
    fireEvent.click(need('Transporte').getByRole('button', { name: 'Yo ayudo con esto' }))
    expect(onOffer).toHaveBeenCalledWith(expect.objectContaining({ kind: 'transport' }))
  })

  it('never shows a stranger who offered or their numbers', () => {
    show(request('HE7PA'))
    expect(screen.queryByRole('region', { name: 'Quienes ofrecieron ayuda' })).toBeNull()
    expect(screen.queryByText(/Andrés/)).toBeNull()
  })

  it('shows the viewer’s own offer instead of offering again, with a way back out', () => {
    const base = request('HE7PA')
    const { onWithdrawPledge } = show({
      ...base,
      myPledges: [
        {
          id: 'pl-1',
          needId: 'need-max-ride',
          quantity: 1,
          note: null,
          status: 'pledged',
          createdAt: now,
          whatsappUrl: 'https://wa.me/573000000006',
        },
      ],
    })
    const ride = need('Transporte')
    expect(ride.getByText('Esperando que Julián R. confirme que llegó.')).toBeTruthy()
    expect(ride.queryByRole('button', { name: 'Yo ayudo con esto' })).toBeNull()
    expect(ride.getByRole('link', { name: 'Escribirle' }).getAttribute('href')).toBe(
      'https://wa.me/573000000006',
    )
    fireEvent.click(ride.getByRole('button', { name: 'Ya no puedo' }))
    expect(onWithdrawPledge).toHaveBeenCalledWith(expect.objectContaining({ id: 'pl-1' }))
  })

  it('a covered request says so, thanks the helpers and offers nothing', () => {
    show(request('HE7PA', { status: 'closed', resolution: 'covered', resolvedAt: now }))
    expect(screen.getByText('Max ya tiene la ayuda que necesitaba.')).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: /Yo ayudo/ })).toEqual([])
  })
})

describe('HelpCasePage — the beneficiary (07 · only the beneficiary confirms)', () => {
  const mine = () => request('NA7LA', { viewer: 'beneficiary' })

  it('sees who offered what, with their number as buttons, never offers to themselves', () => {
    show(mine())
    const panel = within(screen.getByRole('region', { name: 'Quienes ofrecieron ayuda' }))
    const marcela = within(panel.getByRole('listitem', { name: 'Marcela T.' }))
    expect(marcela.getByText(/Puedo recibirla este fin de semana/)).toBeTruthy()
    expect(marcela.getByRole('link', { name: 'Llamar' }).getAttribute('href')).toBe(
      'tel:+573000000008',
    )
    expect(screen.queryAllByRole('button', { name: 'Yo ayudo con esto' })).toEqual([])
  })

  it('confirming that it arrived is one tap', async () => {
    const { calls } = show(mine(), {
      'POST /cases/NA7LA/pledges/pl-nala-home': { body: { id: 'x' } },
    })
    const panel = within(screen.getByRole('region', { name: 'Quienes ofrecieron ayuda' }))
    fireEvent.click(
      within(panel.getByRole('listitem', { name: 'Marcela T.' })).getByRole('button', {
        name: 'Llegó',
      }),
    )
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ status: 'confirmed' }))
  })

  it('a confirmed offer has nothing left to answer', () => {
    show(mine())
    const andres = within(screen.getByRole('listitem', { name: 'Andrés R.' }))
    expect(andres.getByText('Confirmado')).toBeTruthy()
    expect(andres.queryByRole('button', { name: 'Llegó' })).toBeNull()
  })

  it('can cover a need by their word and close the request', async () => {
    const { calls, onAction } = show(mine(), {
      'POST /cases/NA7LA/needs/need-nala-sand/cover': { body: { id: 'x' } },
    })
    const sand = screen.getAllByRole('button', { name: 'Ya tengo lo que necesitaba' })[1]
    if (!sand) throw new Error('no cover button for the second need')
    fireEvent.click(sand)
    await waitFor(() =>
      expect(calls.at(-1)?.key).toBe('POST /cases/NA7LA/needs/need-nala-sand/cover'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Ya no necesita ayuda' }))
    expect(onAction).toHaveBeenCalledWith('close_request')
  })
})
