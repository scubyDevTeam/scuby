import { pngSize } from './pages/PosterPage.ts'
import { expect, tags, test } from './test.ts'

test(
  'the owner frames the poster, picks the square format and downloads it as a PNG',
  tags('@poster', '@POSTER-001'),
  async ({ myCases, casePage }) => {
    const { poster } = casePage
    await myCases.openAsDemoOwner()
    await myCases.openCase('Luna')
    await poster.open()

    await test.step('the poster opens on the story format, framed by its owner', async () => {
      await expect(poster.preview).toBeVisible()
      await expect(poster.preview).toHaveAttribute('data-format', 'story')
      await expect(poster.framer).toBeVisible()
    })

    await test.step('WhatsApp gets the pre-written message ending in the short link', async () => {
      const href = (await poster.whatsapp.getAttribute('href')) ?? ''
      expect(href).toMatch(/^https:\/\/wa\.me\/\?text=/)
      expect(decodeURIComponent(href)).toMatch(/^.*SE BUSCA: Luna — .*\/c\/7K3PQ$/)
    })

    await poster.zoom(1.5)
    await poster.pickFormat('Cuadrado')
    const file = await poster.download()

    await test.step('the download is the square poster, a 1080 × 1080 PNG', async () => {
      expect(file.name).toBe('7K3PQ-square.png')
      expect(pngSize(file.bytes)).toEqual({ width: 1080, height: 1080 })
    })
  },
)
