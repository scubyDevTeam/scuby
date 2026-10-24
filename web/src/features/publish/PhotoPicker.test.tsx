// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithQuery, stubApi } from '../../test-utils'
import { PhotoPicker } from './PhotoPicker'

vi.mock('@platform/image', () => ({
  prepareImage: vi.fn(async (file: File) => {
    if (/heic|broken/i.test(file.name)) throw new Error('cannot decode')
    return new Blob(['x'], { type: 'image/jpeg' })
  }),
  sha256Hex: vi.fn(async () => 'a'.repeat(64)),
}))

function show(onChange = vi.fn()) {
  const calls = stubApi({
    'POST /uploads': {
      status: 201,
      body: {
        url: 'https://img.example/media/a.jpg',
        upload: {
          method: 'PUT',
          url: 'https://bucket.example/incoming/a',
          headers: { 'x-amz-checksum-sha256': 'abc' },
          expires_at: '2026-10-24T12:05:00-05:00',
        },
      },
    },
    'PUT /incoming/a': { status: 200 },
  })
  renderWithQuery(<PhotoPicker purpose="pet" urls={[]} onChange={onChange} />)
  return { onChange, calls }
}

const pick = (name: string, type: string) =>
  fireEvent.change(screen.getByLabelText('Agregar foto'), {
    target: { files: [new File(['x'], name, { type })] },
  })

describe('PhotoPicker — media-pipeline §1', () => {
  it('shows the photo it just sent from the device, not the stored one that may not exist yet', async () => {
    const revoke = vi.fn()
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:local-1', revokeObjectURL: revoke }),
    )
    const { onChange } = show()
    cleanup()
    function Harness() {
      const [urls, setUrls] = useState<string[]>([])
      return (
        <PhotoPicker
          purpose="pet"
          urls={urls}
          onChange={(next) => {
            onChange(next)
            setUrls(next)
          }}
        />
      )
    }
    const { unmount } = renderWithQuery(<Harness />)
    pick('perro.jpg', 'image/jpeg')
    const image = await screen.findByRole('img', { name: 'Foto 1' })
    expect(onChange).toHaveBeenCalledWith(['https://img.example/media/a.jpg'])
    expect(image.getAttribute('src')).toBe('blob:local-1')
    unmount()
    expect(revoke).toHaveBeenCalledWith('blob:local-1')
  })

  it('a photo is prepared on the device, uploaded, and added', async () => {
    const { onChange, calls } = show()
    pick('perro.jpg', 'image/jpeg')
    await vi.waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(['https://img.example/media/a.jpg']),
    )
    // The slot is asked for with the photo's hash and what it is for, then the bytes go to it.
    expect(calls.map((call) => call.key)).toEqual(['POST /uploads', 'PUT /incoming/a'])
    expect(calls[0]?.body).toEqual({
      purpose: 'pet',
      sha256: 'a'.repeat(64),
      content_type: 'image/jpeg',
      bytes: 1,
    })
  })

  it('an iPhone photo the browser cannot open says what to do instead', async () => {
    show()
    pick('IMG_0001.HEIC', 'image/heic')
    expect(await screen.findByText(/es de iPhone \(HEIC\)/)).toBeTruthy()
  })

  it('any other failure asks to try again', async () => {
    show()
    pick('broken.png', 'image/png')
    expect(await screen.findByText('No pudimos subir esa foto. Inténtalo de nuevo.')).toBeTruthy()
  })
})
