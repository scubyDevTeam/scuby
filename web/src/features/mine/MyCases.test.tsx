// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithQuery, stubApi } from '../../test-utils'
import { MyCases } from './MyCases'

const mine = (status: string, open_claim_count = 0) => ({
  code: '7K3PQ',
  vertical: 'lost',
  status,
  title: 'Luna',
  place_name: 'Laureles',
  photo_url: null,
  published_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  open_claim_count,
})

function show(answer: { status?: number; body?: unknown }) {
  stubApi({ 'GET /me/cases': answer })
  renderWithQuery(
    <MyCases
      caseLink={(code, children) => <a href={`/c/${code}`}>{children}</a>}
      publishLink={(children) => <a href="/publicar">{children}</a>}
    />,
  )
}

describe('MyCases', () => {
  it('lists each case with its status, linking to it', async () => {
    show({ body: [mine('active', 1)] })
    expect((await screen.findByRole('link', { name: /Luna/ })).getAttribute('href')).toBe(
      '/c/7K3PQ',
    )
    expect(screen.getByText('Aviso activo')).toBeTruthy()
    expect(screen.getByText('Posible hallazgo')).toBeTruthy()
    expect(screen.getByText('Laureles · hace 2 días')).toBeTruthy()
  })

  it('a closed case carries no possible-find badge', async () => {
    show({ body: [mine('reunited', 1)] })
    expect(await screen.findByText('Ya está en casa')).toBeTruthy()
    expect(screen.queryByText('Posible hallazgo')).toBeNull()
  })

  it('invites to publish when there is nothing yet', async () => {
    show({ body: [] })
    expect(await screen.findByText('Aún no has publicado nada')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Publicar un aviso' }).getAttribute('href')).toBe(
      '/publicar',
    )
  })

  it('has an error state', async () => {
    show({ status: 500 })
    expect(await screen.findByText('No pudimos cargar tus casos')).toBeTruthy()
  })
})
