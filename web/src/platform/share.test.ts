// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { shareLink } from './share'

const link = { title: 'Se busca: Luna', text: 'Ayúdanos', url: 'https://example.test/c/7K3PQ' }

const stubNavigator = (parts: { share?: unknown; writeText?: unknown }) =>
  vi.stubGlobal('navigator', { share: parts.share, clipboard: { writeText: parts.writeText } })

describe('shareLink', () => {
  it('uses the share sheet when the device has one', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    stubNavigator({ share })
    expect(await shareLink(link)).toBe('shared')
    expect(share).toHaveBeenCalledWith(link)
  })

  it('reports a dismissed share sheet as cancelled, without copying', async () => {
    const writeText = vi.fn()
    stubNavigator({
      share: vi.fn().mockRejectedValue(new DOMException('dismissed', 'AbortError')),
      writeText,
    })
    expect(await shareLink(link)).toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('copies the link when there is no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubNavigator({ writeText })
    expect(await shareLink(link)).toBe('copied')
    expect(writeText).toHaveBeenCalledWith(link.url)
  })

  it('says so when the device can do neither', async () => {
    stubNavigator({ writeText: vi.fn().mockRejectedValue(new Error('denied')) })
    expect(await shareLink(link)).toBe('unavailable')
  })
})
