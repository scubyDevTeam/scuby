// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithQuery, stubApi } from '../../test-utils'
import { PhotoPicker } from './PhotoPicker'

vi.mock('@platform/image', () => ({
  prepareImage: vi.fn(async (file: File) => {
    if (/heic|broken/i.test(file.name)) throw new Error('cannot decode')
    return new Blob(['x'], { type: 'image/jpeg' })
  }),
}))

function show(onChange = vi.fn()) {
  stubApi({ 'POST /uploads': { status: 201, body: { url: 'data:image/jpeg;base64,AAAA' } } })
  renderWithQuery(<PhotoPicker urls={[]} onChange={onChange} />)
  return onChange
}

const pick = (name: string, type: string) =>
  fireEvent.change(screen.getByLabelText('Agregar foto'), {
    target: { files: [new File(['x'], name, { type })] },
  })

describe('PhotoPicker — media-pipeline §1', () => {
  it('a photo is prepared on the device, uploaded, and added', async () => {
    const onChange = show()
    pick('perro.jpg', 'image/jpeg')
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(['data:image/jpeg;base64,AAAA']))
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
