// @vitest-environment jsdom
import { type LostCase, parseCase } from '@contracts/case'
import type { Crop, PosterFormat } from '@domain/shared/poster'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cases } from '../../mocks/fixtures'
import { stubApi } from '../../test-utils'
import { PosterSheet } from './PosterSheet'
import type { PreparedPoster, PreparePoster } from './render'

const link = { url: 'https://example.test/c/7K3PQ', display: 'example.test/c/7K3PQ' }
const brand = { name: 'Marca', markUrl: '/brand/mark-white.png' }

function lost(viewer: LostCase['viewer'], overrides: Partial<LostCase['pet']> = {}): LostCase {
  const parsed = parseCase(cases(viewer === 'owner' ? 'responsible' : 'public')['7K3PQ'])
  if (parsed.vertical !== 'lost') throw new Error('expected a lost case')
  return { ...parsed, pet: { ...parsed.pet, ...overrides } }
}

/** The canvas seam: records what was drawn and exported instead of painting pixels. */
function fakePoster(photoSize: PreparedPoster['photoSize'] = { width: 1600, height: 1200 }) {
  const drawn: { format: PosterFormat; crop: Crop; scale: number }[] = []
  const exported: PosterFormat[] = []
  const poster: PreparedPoster = {
    photoSize,
    draw: (_canvas, format, crop, scale) => {
      drawn.push({ format, crop, scale })
    },
    toFile: async (format) => {
      exported.push(format)
      return new File(['x'], `7K3PQ-${format}.png`, { type: 'image/png' })
    },
  }
  const prepare: PreparePoster = vi.fn(async () => poster)
  return { prepare, drawn, exported }
}

const stubNavigator = (parts: { share?: unknown; canShare?: unknown; writeText?: unknown }) =>
  vi.stubGlobal('navigator', {
    share: parts.share,
    canShare: parts.canShare,
    clipboard: { writeText: parts.writeText ?? vi.fn().mockResolvedValue(undefined) },
  })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PosterSheet — loading and error', () => {
  it('shows a placeholder while fonts, photo and QR load, then the story preview', async () => {
    const fake = fakePoster()
    render(
      <PosterSheet posterCase={lost('public')} link={link} brand={brand} prepare={fake.prepare} />,
    )
    expect(screen.getByRole('button', { name: /Compartir imagen/ })).toHaveProperty(
      'disabled',
      true,
    )
    await waitFor(() => expect(fake.drawn.at(-1)?.format).toBe('story'))
    expect(screen.getByRole('button', { name: /Compartir imagen/ })).toHaveProperty(
      'disabled',
      false,
    )
    // The preview is drawn small, never at the poster's full size.
    expect(fake.drawn.at(-1)?.scale).toBeLessThan(1)
  })

  it('when the poster cannot be made, says so and keeps the WhatsApp link', async () => {
    const prepare: PreparePoster = vi.fn().mockRejectedValue(new Error('tainted'))
    render(<PosterSheet posterCase={lost('public')} link={link} brand={brand} prepare={prepare} />)
    expect(await screen.findByText(/No pudimos crear el afiche/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /WhatsApp/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Descargar/ })).toBeNull()
  })
})

describe('PosterSheet — formats and the three buttons (docs/product/10 §4)', () => {
  it('redraws the format picked, and downloads that one; print is the PDF', async () => {
    const fake = fakePoster()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:poster', revokeObjectURL: vi.fn() })
    render(
      <PosterSheet posterCase={lost('public')} link={link} brand={brand} prepare={fake.prepare} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cuadrado' }))
    await waitFor(() => expect(fake.drawn.at(-1)?.format).toBe('square'))
    fireEvent.click(screen.getByRole('button', { name: 'Descargar' }))
    await waitFor(() => expect(fake.exported).toEqual(['square']))
    expect(click).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }))
    expect(screen.getByText(/El código QR sale de \d+(,\d)? cm/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Descargar PDF para imprimir' })).toBeTruthy()
  })

  it('WhatsApp carries the pre-written message, ending in the short link', () => {
    render(
      <PosterSheet
        posterCase={lost('public')}
        link={link}
        brand={brand}
        prepare={fakePoster().prepare}
      />,
    )
    const href = screen
      .getByRole('link', { name: 'Enviar el enlace por WhatsApp' })
      .getAttribute('href')
    expect(href).toMatch(/^https:\/\/wa\.me\/\?text=/)
    expect(decodeURIComponent(href ?? '')).toMatch(
      /SE BUSCA: Luna — .*https:\/\/example\.test\/c\/7K3PQ$/,
    )
  })

  it('«Compartir» hands the story image and the message to the share sheet', async () => {
    const fake = fakePoster()
    const share = vi.fn().mockResolvedValue(undefined)
    stubNavigator({ share, canShare: () => true })
    render(
      <PosterSheet posterCase={lost('public')} link={link} brand={brand} prepare={fake.prepare} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cuadrado' }))
    await waitFor(() => expect(fake.drawn.length).toBeGreaterThan(0))

    fireEvent.click(screen.getByRole('button', { name: /Compartir imagen/ }))

    await waitFor(() => expect(share).toHaveBeenCalledOnce())
    expect(fake.exported).toEqual(['story'])
    expect(share.mock.calls[0]?.[0].text).toMatch(/c\/7K3PQ$/)
  })

  it('without a share sheet, downloads and copies, and tells the person so', async () => {
    const fake = fakePoster()
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubNavigator({ writeText })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:poster', revokeObjectURL: vi.fn() })
    render(
      <PosterSheet posterCase={lost('public')} link={link} brand={brand} prepare={fake.prepare} />,
    )
    await waitFor(() => expect(fake.drawn.length).toBeGreaterThan(0))

    fireEvent.click(screen.getByRole('button', { name: /Compartir imagen/ }))

    expect(
      await screen.findByText('Descargamos la imagen y copiamos el mensaje. Pégalo en WhatsApp.'),
    ).toBeTruthy()
    expect(writeText.mock.calls[0]?.[0]).toMatch(/c\/7K3PQ$/)
  })
})

describe('PosterSheet — who sees what', () => {
  it('the owner frames the photo and gets the tip; «Centrar de nuevo» resets', async () => {
    const fake = fakePoster()
    render(
      <PosterSheet posterCase={lost('owner')} link={link} brand={brand} prepare={fake.prepare} />,
    )
    const slider = await screen.findByRole('slider', { name: 'Encuadre' })
    fireEvent.change(slider, { target: { value: '2' } })
    await waitFor(() => expect(fake.drawn.at(-1)?.crop.zoom).toBe(2))

    fireEvent.click(screen.getByRole('button', { name: 'Centrar de nuevo' }))
    await waitFor(() => expect(fake.drawn.at(-1)?.crop).toEqual({ zoom: 1, panX: 0, panY: 0 }))
    expect(screen.getByText(/Súbelo a tus historias/)).toBeTruthy()
  })

  it('a helper gets the same poster and buttons, without the framer or the tip', async () => {
    const fake = fakePoster()
    render(
      <PosterSheet posterCase={lost('public')} link={link} brand={brand} prepare={fake.prepare} />,
    )
    await waitFor(() => expect(fake.drawn.length).toBeGreaterThan(0))
    expect(screen.queryByRole('slider')).toBeNull()
    expect(screen.queryByText(/Súbelo a tus historias/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Descargar' })).toBeTruthy()
  })

  it('without a photo there is nothing to frame', async () => {
    const fake = fakePoster(null)
    render(
      <PosterSheet
        posterCase={lost('owner', { photoUrls: [] })}
        link={link}
        brand={brand}
        prepare={fake.prepare}
      />,
    )
    await waitFor(() => expect(fake.drawn.length).toBeGreaterThan(0))
    expect(screen.queryByRole('slider')).toBeNull()
    expect(vi.mocked(fake.prepare).mock.calls[0]?.[0].content.photoUrl).toBeNull()
  })

  it('records which way the case was shared, without waiting on it (10 §5)', async () => {
    const calls = stubApi({ 'POST /cases/7K3PQ/shares': { status: 204 } })
    const fake = fakePoster()
    stubNavigator({ share: vi.fn().mockResolvedValue(undefined), canShare: () => true })
    render(
      <PosterSheet posterCase={lost('public')} link={link} brand={brand} prepare={fake.prepare} />,
    )
    fireEvent.click(screen.getByRole('link', { name: 'Enviar el enlace por WhatsApp' }))
    await waitFor(() => expect(fake.drawn.length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: /Compartir imagen/ }))
    await waitFor(() =>
      expect(calls.filter((c) => c.key === 'POST /cases/7K3PQ/shares').map((c) => c.body)).toEqual([
        { channel: 'whatsapp', format: 'text' },
        { channel: 'system', format: 'story' },
      ]),
    )
  })
})
