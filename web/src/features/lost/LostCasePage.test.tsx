// @vitest-environment jsdom
import { type LostCase, parseCase } from '@contracts/case'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { cases } from '../../mocks/fixtures'
import { renderWithQuery, stubApi } from '../../test-utils'
import { LostCasePage } from './LostCasePage'

const now = new Date()

function lostCase(code: string, overrides: Partial<LostCase> = {}): LostCase {
  const viewer = overrides.viewer && overrides.viewer !== 'public' ? 'responsible' : 'public'
  const parsed = parseCase(cases(viewer)[code])
  if (parsed.vertical !== 'lost') throw new Error('expected a lost case')
  return { ...parsed, ...overrides }
}

function show(caseData: LostCase) {
  const onAction = vi.fn()
  renderWithQuery(
    <LostCasePage
      lostCase={caseData}
      now={now}
      shortUrl="example.test/c/7K3PQ"
      backLink={<a href="/">Volver</a>}
      mapStyleUrl={undefined}
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
    const items = within(screen.getByRole('list', { name: 'Avistamientos' })).getAllByRole(
      'listitem',
    )
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

describe('LostCasePage — photos', () => {
  it('steps through the photos and wraps around', () => {
    show(lostCase('7K3PQ'))
    const next = screen.getByRole('button', { name: 'Ver la siguiente foto' })
    expect(next.textContent).toBe('1 / 4')
    fireEvent.click(next)
    expect(next.textContent).toBe('2 / 4')
    fireEvent.click(screen.getByRole('button', { name: 'Ver foto 4' }))
    fireEvent.click(next)
    expect(next.textContent).toBe('1 / 4')
  })
})

describe('LostCasePage — the owner', () => {
  it('can close an active case as reunited', () => {
    const onAction = show(lostCase('7K3PQ', { viewer: 'owner' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ya apareció' }))
    expect(onAction).toHaveBeenCalledWith('confirm_reunited')
    expect(screen.queryByRole('button', { name: /La vi/ })).toBeNull()
  })

  it('sees who says they have her — with the number as buttons — instead of the public badge', () => {
    show(lostCase('7K3PQ', { viewer: 'owner' }))
    const claims = within(screen.getByRole('region', { name: 'Posibles hallazgos' }))
    expect(claims.getByText('+573114829017')).toBeTruthy()
    expect(claims.getByRole('link', { name: 'Abrir WhatsApp' }).getAttribute('href')).toBe(
      'https://wa.me/573114829017',
    )
    expect(claims.getByRole('link', { name: 'Llamar' }).getAttribute('href')).toBe(
      'tel:+573114829017',
    )
    expect(screen.queryByText('Posible hallazgo.')).toBeNull()
  })

  it('a helper never sees the claims or their phones', () => {
    show(lostCase('7K3PQ'))
    expect(screen.queryByRole('region', { name: 'Posibles hallazgos' })).toBeNull()
    expect(screen.queryByText('+573114829017')).toBeNull()
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

describe('LostCasePage — the check-in the owner owes (04 · The follow-up loop)', () => {
  const answerPath = 'POST /cases/M2TQ4/checkins/ck-milo-1/answer'
  const question = () => within(screen.getByRole('region', { name: 'Pregunta pendiente' }))

  it('asks «¿sigue perdida?» framed as the listing going away, and answers it in one tap', async () => {
    const calls = stubApi({ [answerPath]: { body: { id: 'ck-milo-1' } } })
    show(lostCase('M2TQ4', { viewer: 'owner' }))
    expect(await screen.findByText('El aviso de Milo sigue publicado.')).toBeTruthy()

    fireEvent.click(question().getByRole('button', { name: 'Sigue perdida' }))

    await waitFor(() => expect(calls.some((c) => c.key === answerPath)).toBe(true))
    expect(calls.find((c) => c.key === answerPath)?.body).toEqual({
      response: 'still_lost',
      resolution_attribution: null,
      resolution: null,
    })
  })

  it('«Ya apareció» and «Eliminar» continue in the case’s own close and delete', async () => {
    const onAction = show(lostCase('M2TQ4', { viewer: 'owner' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ya apareció 🎉' }))
    fireEvent.click(question().getByRole('button', { name: 'Eliminar' }))
    expect(onAction.mock.calls).toEqual([['confirm_reunited'], ['cancel']])
  })

  it('shows the close and the delete once — in the question, not again below it', async () => {
    show(lostCase('M2TQ4', { viewer: 'owner' }))
    await screen.findByRole('region', { name: 'Pregunta pendiente' })
    expect(screen.queryByRole('button', { name: 'Ya apareció' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Eliminar aviso' })).toBeNull()
  })

  it('a claim check-in asks about the claim, its number shown, and keeps the case’s own buttons', async () => {
    const path = 'POST /cases/7K3PQ/checkins/ck-luna-claim-1/answer'
    const calls = stubApi({ [path]: { body: { id: 'ck-luna-claim-1' } } })
    show(
      lostCase('7K3PQ', {
        viewer: 'owner',
        pendingCheckin: {
          id: 'ck-luna-claim-1',
          trigger: 'post_recovery_claim',
          claimId: 'claim-luna',
          askedAt: now,
        },
      }),
    )
    expect(await screen.findByText('Alguien dice que tiene a Luna.')).toBeTruthy()
    expect(question().getByText('Dejó su número: +573114829017')).toBeTruthy()
    expect(question().getByRole('button', { name: 'Sí, es Luna 🎉' })).toBeTruthy()
    expect(question().getByRole('button', { name: 'No es Luna' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ya apareció' })).toBeTruthy()

    fireEvent.click(question().getByRole('button', { name: 'Aún verificando' }))
    await waitFor(() =>
      expect(calls.find((c) => c.key === path)?.body).toMatchObject({
        response: 'still_verifying',
      }),
    )
  })

  it('says so when the answer could not be saved', async () => {
    stubApi({ [answerPath]: { status: 500 } })
    show(lostCase('M2TQ4', { viewer: 'owner' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sigue perdida' }))
    expect(await screen.findByText('No pudimos guardar tu respuesta.')).toBeTruthy()
  })

  it('a helper is never asked, even if a check-in reached the page', async () => {
    show(
      lostCase('M2TQ4', {
        pendingCheckin: { id: 'ck-milo-1', trigger: 'time_based', claimId: null, askedAt: now },
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByRole('region', { name: 'Pregunta pendiente' })).toBeNull()
  })
})

describe('LostCasePage — the owner’s hand on the pins (04 · Display rules 3 and 5)', () => {
  const timeline = () =>
    within(screen.getByRole('list', { name: 'Avistamientos' })).getAllByRole('listitem')

  it('stars a pin as useful and hides another, sending only what changes', async () => {
    const calls = stubApi({
      'PATCH /cases/7K3PQ/sightings/s3': { body: { id: 's3' } },
      'PATCH /cases/7K3PQ/sightings/s2': { body: { id: 's2' } },
    })
    show(lostCase('7K3PQ', { viewer: 'owner' }))
    const [newest, middle] = timeline()
    fireEvent.click(await within(newest!).findByRole('button', { name: 'Marcar como útil' }))
    await waitFor(() => expect(calls.some((c) => c.key.endsWith('/s3'))).toBe(true))
    fireEvent.click(within(middle!).getByRole('button', { name: 'Ocultar del mapa' }))
    await waitFor(() => expect(calls.some((c) => c.key.endsWith('/s2'))).toBe(true))

    expect(calls.find((c) => c.key.endsWith('/s3'))?.body).toEqual({ highlighted: true })
    expect(calls.find((c) => c.key.endsWith('/s2'))?.body).toEqual({ hidden: true })
  })

  it('a starred pin reads as pressed', async () => {
    const owner = lostCase('7K3PQ', { viewer: 'owner' })
    show({
      ...owner,
      sightings: owner.sightings.map((s) => ({ ...s, highlightedByOwner: s.id === 's1' })),
    })
    const oldest = timeline().at(-1)!
    const star = await within(oldest).findByRole('button', { name: 'Marcar como útil' })
    expect(star.getAttribute('aria-pressed')).toBe('true')
  })

  it('a hidden pin leaves the trail and waits apart, with its way back', async () => {
    const calls = stubApi({ 'PATCH /cases/7K3PQ/sightings/s3': { body: { id: 's3' } } })
    const owner = lostCase('7K3PQ', { viewer: 'owner' })
    show({ ...owner, sightings: owner.sightings.map((s) => ({ ...s, hidden: s.id === 's3' })) })

    expect(timeline().map((item) => item.textContent?.[0])).toEqual(['2', '1'])
    expect(screen.getByText('2 avistamientos')).toBeTruthy()
    const hidden = within(await screen.findByRole('list', { name: 'Avistamientos ocultos' }))
    expect(hidden.getByText('«Iba hacia el parque, con collar rojo»')).toBeTruthy()
    expect(hidden.queryByRole('button', { name: 'Marcar como útil' })).toBeNull()

    fireEvent.click(hidden.getByRole('button', { name: 'Volver a mostrar' }))
    await waitFor(() =>
      expect(calls.find((c) => c.key.endsWith('/s3'))?.body).toEqual({ hidden: false }),
    )
  })

  it('a helper gets no tools, and never a hidden pin', async () => {
    const helper = lostCase('7K3PQ')
    show({ ...helper, sightings: helper.sightings.map((s) => ({ ...s, hidden: s.id === 's3' })) })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(timeline()).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Marcar como útil' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ocultar del mapa' })).toBeNull()
    expect(screen.queryByText('Ocultos del mapa')).toBeNull()
  })
})
