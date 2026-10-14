// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyText, downloadFile, shareImage } from './share'

const file = new File(['png'], '7K3PQ-story.png', { type: 'image/png' })
const text =
  'SE BUSCA: Luna — Laureles. Información al día y contacto: https://example.test/c/7K3PQ'

const stubNavigator = (parts: { share?: unknown; canShare?: unknown; writeText?: unknown }) =>
  vi.stubGlobal('navigator', {
    share: parts.share,
    canShare: parts.canShare,
    clipboard: { writeText: parts.writeText },
  })

let clicked: { href: string; download: string }[]

beforeEach(() => {
  clicked = []
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:poster', revokeObjectURL: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ href: this.getAttribute('href') ?? '', download: this.download })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('shareImage (docs/product/10 §4 · Compartir)', () => {
  it('hands the image and the message to the share sheet when it takes files', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    stubNavigator({ share, canShare: () => true })
    expect(await shareImage({ file, text })).toEqual({ kind: 'shared' })
    expect(share).toHaveBeenCalledWith({ files: [file], text })
    expect(clicked).toEqual([])
  })

  it('reports a dismissed share sheet as cancelled, with nothing downloaded or copied', async () => {
    const writeText = vi.fn()
    stubNavigator({
      share: vi.fn().mockRejectedValue(new DOMException('dismissed', 'AbortError')),
      canShare: () => true,
      writeText,
    })
    expect(await shareImage({ file, text })).toEqual({ kind: 'cancelled' })
    expect(writeText).not.toHaveBeenCalled()
    expect(clicked).toEqual([])
  })

  it('falls back to download + copy when the sheet cannot take files', async () => {
    const share = vi.fn()
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubNavigator({ share, canShare: () => false, writeText })
    expect(await shareImage({ file, text })).toEqual({ kind: 'saved', copied: true })
    expect(share).not.toHaveBeenCalled()
    expect(clicked).toEqual([{ href: 'blob:poster', download: '7K3PQ-story.png' }])
    expect(writeText).toHaveBeenCalledWith(text)
  })

  it('falls back too when there is no share sheet at all', async () => {
    stubNavigator({ writeText: vi.fn().mockResolvedValue(undefined) })
    expect(await shareImage({ file, text })).toEqual({ kind: 'saved', copied: true })
  })

  it('falls back when the sheet fails for another reason', async () => {
    stubNavigator({
      share: vi.fn().mockRejectedValue(new DOMException('no gesture', 'NotAllowedError')),
      canShare: () => true,
      writeText: vi.fn().mockResolvedValue(undefined),
    })
    expect(await shareImage({ file, text })).toEqual({ kind: 'saved', copied: true })
    expect(clicked).toHaveLength(1)
  })

  it('says the message was not copied when the clipboard refuses', async () => {
    stubNavigator({ writeText: vi.fn().mockRejectedValue(new Error('denied')) })
    expect(await shareImage({ file, text })).toEqual({ kind: 'saved', copied: false })
  })
})

describe('downloadFile and copyText', () => {
  it('downloads under the file’s own name and leaves no anchor behind', () => {
    downloadFile(file)
    expect(clicked).toEqual([{ href: 'blob:poster', download: '7K3PQ-story.png' }])
    expect(document.querySelector('a')).toBeNull()
  })

  it('answers whether the text reached the clipboard', async () => {
    stubNavigator({ writeText: vi.fn().mockResolvedValue(undefined) })
    expect(await copyText(text)).toBe(true)
    stubNavigator({ writeText: vi.fn().mockRejectedValue(new Error('denied')) })
    expect(await copyText(text)).toBe(false)
  })
})
