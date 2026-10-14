// @vitest-environment jsdom
import type { AdoptionCase } from '@contracts/adoption'
import { parseCase } from '@contracts/case'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { cases } from '../../mocks/fixtures'
import { renderWithQuery, stubApi } from '../../test-utils'
import { AdoptionCasePage } from './AdoptionCasePage'
import { ListerPanel } from './ListerPanel'

const now = new Date()

function listing(code: string, overrides: Partial<AdoptionCase> = {}): AdoptionCase {
  const viewer = overrides.viewer === 'lister' ? 'responsible' : 'public'
  const parsed = parseCase(cases(viewer)[code])
  if (parsed.vertical !== 'adoption') throw new Error('expected an adoption listing')
  return { ...parsed, ...overrides }
}

function show(data: AdoptionCase, routes: Parameters<typeof stubApi>[0] = {}) {
  const calls = stubApi(routes)
  const onAction = vi.fn()
  const spies = { onRecord: vi.fn(), onWithdraw: vi.fn() }
  renderWithQuery(
    <AdoptionCasePage
      listing={data}
      now={now}
      shortUrl="example.test/c/AD9PT"
      backLink={<a href="/">Volver</a>}
      mapStyleUrl={undefined}
      onAction={onAction}
      listerPanel={<ListerPanel listing={data} now={now} {...spies} />}
    />,
  )
  return { calls, onAction, ...spies }
}

describe('AdoptionCasePage — seen by anyone (06 · identity ladder)', () => {
  it('names the animal, discloses the fee — zero included — and says who published it, honestly', () => {
    show(listing('AD9PT'))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Nube')
    expect(screen.getByText('En adopción')).toBeTruthy()
    expect(screen.getByText('Sin cuota')).toBeTruthy()
    expect(
      screen.getByText('Publicado por una persona — la verificación es entre ustedes.'),
    ).toBeTruthy()
    expect(screen.getByText('Sin salir a la calle')).toBeTruthy()
  })

  it('offers «Me interesa» — never a phone or a WhatsApp link before the interest', () => {
    const { onAction } = show(listing('AD9PT'))
    fireEvent.click(screen.getByRole('button', { name: /Me interesa/ }))
    expect(onAction).toHaveBeenCalledWith('express_interest')
    expect(screen.queryByRole('link', { name: /WhatsApp/ })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Personas interesadas' })).toBeNull()
  })

  it('surfaces the health flags and says what a fee covers', () => {
    show(listing('B3TOS'))
    const health = within(screen.getByRole('region', { name: 'Su salud' }))
    expect(health.getByText('Adulto mayor')).toBeTruthy()
    expect(health.getByText('Necesita ayuda para moverse')).toBeTruthy()
    expect(screen.getByText('Cubre esterilización, vacunas y desparasitación.')).toBeTruthy()
  })

  it('«en proceso» invites backups instead of closing the door', () => {
    show(listing('B3TOS'))
    expect(screen.getByText('En proceso')).toBeTruthy()
    expect(screen.getByText(/puedes anotarte como segunda opción/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Me interesa/ })).toBeTruthy()
  })

  it('with an interest already sent: back to the conversation, or «ya no me interesa»', () => {
    const { onAction } = show(
      listing('AD9PT', {
        myInterest: {
          id: 'int-1',
          status: 'open',
          createdAt: now,
          whatsappUrl: 'https://wa.me/573000000005',
          externalUrl: null,
        },
      }),
    )
    expect(screen.queryByRole('button', { name: /Me interesa/ })).toBeNull()
    expect(screen.getByText('Ya te anotaste.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ya no me interesa' }))
    expect(onAction).toHaveBeenCalledWith('withdraw_interest')
  })

  it('tells the chosen person it is them', () => {
    show(
      listing('B3TOS', {
        myInterest: {
          id: 'x',
          status: 'chosen',
          createdAt: now,
          whatsappUrl: null,
          externalUrl: null,
        },
      }),
    )
    expect(screen.getByText('Te eligieron.')).toBeTruthy()
    expect(screen.queryByText(/segunda opción/)).toBeNull()
  })

  it('an adopted listing shows the banner and no actions', () => {
    show(listing('ADPT8'))
    expect(screen.getByText('Adoptado')).toBeTruthy()
    expect(screen.getByText('¡Simón ya tiene hogar!')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('an archived listing is reopenable by its lister only', () => {
    const archived = { status: 'expired' as const, resolvedAt: now }
    show(listing('AD9PT', archived))
    expect(screen.getByText('Quien la publicó puede reactivarla.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reactivar publicación' })).toBeNull()
  })
})

describe('AdoptionCasePage — the lister (06 · What the lister sees)', () => {
  const mine = () => listing('M1SHI', { viewer: 'lister' })

  it('a list, not an inbox: each person with the intro as chips and facts from the account', () => {
    show(mine())
    const list = within(screen.getByRole('region', { name: 'Personas interesadas' }))
    expect(list.getByText('2 personas interesadas')).toBeTruthy()
    const andres = within(list.getByRole('listitem', { name: 'Andrés R.' }))
    expect(andres.getByText('Apartamento')).toBeTruthy()
    expect(andres.getByText('Sin patio')).toBeTruthy()
    expect(andres.getByText(/1 avistamiento reportado/)).toBeTruthy()
    expect(andres.getByText(/tiene 3 solicitudes de adopción abiertas/)).toBeTruthy()
    expect(andres.getByRole('link', { name: 'Escribirle por WhatsApp' })).toBeTruthy()
    expect(screen.getByText(/Encuéntrense en un lugar público/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Me interesa/ })).toBeNull()
  })

  it('choosing someone asks the server for `chosen`', async () => {
    const { calls } = show(mine(), {
      'POST /cases/M1SHI/interests/int-misha-julian': { body: { id: 'int-misha-julian' } },
    })
    const julian = within(screen.getByRole('listitem', { name: 'Julián R.' }))
    fireEvent.click(julian.getByRole('button', { name: 'Elegir' }))
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ status: 'chosen' }))
  })

  it('with someone chosen, «no se concretó» comes before choosing another', () => {
    const base = mine()
    show({
      ...base,
      reserved: true,
      interests: base.interests.map((i, n) => (n === 0 ? { ...i, status: 'chosen' } : i)),
    })
    expect(screen.getAllByRole('button', { name: 'No se concretó' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Elegir' })).toBeNull()
  })

  it('«¿sigue disponible?» names the people waiting, and «sigue disponible» answers it', async () => {
    const { calls, onRecord } = show(mine(), {
      'POST /cases/M1SHI/checkins/ck-misha-1/answer': { body: { id: 'ck-misha-1' } },
    })
    const checkin = within(screen.getByRole('region', { name: '¿Sigue disponible?' }))
    expect(checkin.getByText('2 personas preguntaron por Misha. ¿Sigue disponible?')).toBeTruthy()
    fireEvent.click(checkin.getByRole('button', { name: 'Ya fue adoptado 🎉' }))
    expect(onRecord).toHaveBeenCalled()
    fireEvent.click(checkin.getByRole('button', { name: 'Sigue disponible' }))
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ response: 'still_available' }))
  })

  it('nobody interested yet: an empty state that suggests sharing', () => {
    show(listing('AD9PT', { viewer: 'lister', interests: [], pendingCheckin: null }))
    expect(screen.getByText('Todavía nadie dijo «Me interesa».')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ya no está disponible' })).toBeTruthy()
  })
})
