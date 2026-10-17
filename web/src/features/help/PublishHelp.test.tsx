// @vitest-environment jsdom
import { parseCase } from '@contracts/case'
import type { FoundCase } from '@contracts/found'
import type { User } from '@contracts/session'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cases } from '../../mocks/fixtures'
import { renderWithQuery, stubApi } from '../../test-utils'
import { PublishHelp } from './PublishHelp'

const carolina: User = {
  id: 'u1',
  displayName: 'Carolina',
  email: 'c@correo.co',
  phone: '+573007152284',
}
const nala = {
  id: 'pet-nala',
  name: 'Nala',
  species: 'cat',
  size: 'medium',
  colors: ['orange'],
  marks: null,
  photo_urls: [],
  active_case_code: null,
  reopenable_case_code: null,
}

// Each form starts empty: a draft kept by an earlier test would open in its place.
beforeEach(() => localStorage.clear())

function show(routes: Parameters<typeof stubApi>[0] = {}, fromFound: FoundCase | null = null) {
  const calls = stubApi({ 'GET /me/pets': { body: [nala] }, ...routes })
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (ok: (p: unknown) => void) =>
        ok({ coords: { latitude: 6.2447, longitude: -75.5916 } }),
    },
  })
  renderWithQuery(
    <PublishHelp
      user={carolina}
      mapStyleUrl={undefined}
      demoCode="123456"
      legal="Términos"
      onExit={() => {}}
      caseLink={(code, children) => <a href={`/c/${code}`}>{children}</a>}
      fromFound={fromFound}
    />,
  )
  return calls
}

const go = (name = 'Continuar') => fireEvent.click(screen.getByRole('button', { name }))
const heading = () => screen.getByRole('heading', { level: 1 }).textContent

describe('PublishHelp — 07 · Publishing', () => {
  it('a pet the beneficiary already has needs no description', async () => {
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Nala' }))
    expect(screen.queryByLabelText('Nombre')).toBeNull()
    go()
    expect(heading()).toBe('¿Qué necesita?')
  })

  it('needs at least one thing asked, each saying exactly what', async () => {
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Nala' }))
    go()
    go()
    expect(screen.getByRole('alert').textContent).toBe('Elige al menos una cosa que necesite')
    fireEvent.click(screen.getByRole('button', { name: 'Agregar Transporte' }))
    go()
    expect(screen.getByRole('alert').textContent).toBe('Di exactamente qué necesita en cada una')
  })

  it('offers at most three needs, one of each kind', async () => {
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Nala' }))
    go()
    for (const kind of ['Hogar temporal', 'Transporte', 'Insumos']) {
      fireEvent.click(screen.getByRole('button', { name: `Agregar ${kind}` }))
    }
    expect(screen.queryAllByRole('button', { name: /^Agregar / })).toEqual([])
  })

  it('publishes the pet, the needs, where and the story — never an amount', async () => {
    const calls = show({ 'POST /help-requests': { status: 201, body: { code: 'H3LPX' } } })
    fireEvent.click(await screen.findByRole('button', { name: 'Nala' }))
    go()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar Hogar temporal' }))
    fireEvent.change(screen.getByLabelText('¿Por cuánto tiempo y para qué?'), {
      target: { value: 'Tres semanas' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar Insumos' }))
    fireEvent.change(screen.getByLabelText('¿Qué exactamente?'), {
      target: { value: 'Arena para gato' },
    })
    go()
    fireEvent.click(await screen.findByRole('button', { name: 'Usar mi ubicación' }))
    await screen.findByText('Zona marcada.')
    fireEvent.change(screen.getByLabelText(/Cuéntales a tus vecinos/), {
      target: { value: 'Apareció con una pata lastimada.' },
    })
    go('Publicar solicitud')

    expect(await screen.findByText('¡Solicitud publicada!')).toBeTruthy()
    const body = calls.find((c) => c.key === 'POST /help-requests')?.body as Record<string, unknown>
    expect(body).toMatchObject({
      pet_id: 'pet-nala',
      pet: null,
      needs: [
        { kind: 'foster', detail: 'Tres semanas', target: 1, needed_by: null },
        { kind: 'supplies', detail: 'Arena para gato', target: null, needed_by: null },
      ],
      story: 'Apareció con una pata lastimada.',
      phone: null,
    })
    expect(JSON.stringify(body)).not.toMatch(/amount|goal|price|link/)
  })
})

describe('PublishHelp — for the animal a custodian holds (07 · The pet)', () => {
  const dog = () => {
    const parsed = parseCase(cases('responsible').C4STD)
    if (parsed.vertical !== 'found') throw new Error('expected found')
    return parsed
  }

  it('starts on the animal, described already, and sends its case instead of a pet', async () => {
    const calls = show({ 'POST /help-requests': { status: 201, body: { code: 'H3LPX' } } }, dog())
    expect(screen.getByText('Para el animal que encontraste')).toBeTruthy()
    expect(screen.getByText('Perro café, mediano')).toBeTruthy()
    expect(screen.queryByLabelText('Nombre')).toBeNull()
    go()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar Insumos' }))
    fireEvent.change(screen.getByLabelText('¿Qué exactamente?'), {
      target: { value: 'Concentrado' },
    })
    go()
    // The zone starts where it was found.
    expect(await screen.findByText('Zona marcada.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Cuéntales a tus vecinos/), {
      target: { value: 'Lo cuido mientras aparece su familia.' },
    })
    go('Publicar solicitud')
    expect(await screen.findByText('¡Solicitud publicada!')).toBeTruthy()
    expect(calls.find((c) => c.key === 'POST /help-requests')?.body).toMatchObject({
      from_case_code: 'C4STD',
      pet_id: null,
      pet: null,
    })
  })
})

describe('the form survives a reload', () => {
  it('opens on what was typed, says so, and «Empezar de nuevo» clears it', async () => {
    show()
    fireEvent.change(await screen.findByLabelText('Nombre'), { target: { value: 'Toby' } })
    cleanup()
    show()
    expect(((await screen.findByLabelText('Nombre')) as HTMLInputElement).value).toBe('Toby')
    expect(screen.getByText('Seguimos donde ibas.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Empezar de nuevo' }))
    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('')
  })
})
