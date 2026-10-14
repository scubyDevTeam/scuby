import { readFile } from 'node:fs/promises'
import type { Locator, Page } from '@playwright/test'
import { step } from './step.ts'

/** «Comparte a Luna»: the poster and the three share buttons of a case (docs/product/10 §3–4). */
export class PosterPage {
  readonly page: Page
  readonly sheet: Locator
  readonly preview: Locator
  readonly framer: Locator
  readonly whatsapp: Locator
  readonly saved: Locator

  constructor(page: Page) {
    this.page = page
    this.sheet = page.getByRole('dialog')
    this.preview = this.sheet.getByRole('img', { name: /Vista previa del afiche/ })
    this.framer = this.sheet.getByRole('slider', { name: 'Encuadre' })
    this.whatsapp = this.sheet.getByRole('link', { name: 'Enviar el enlace por WhatsApp' })
    this.saved = this.sheet.getByText('Descargamos la imagen y copiamos el mensaje.', {
      exact: false,
    })
  }

  open() {
    return step('Open the poster from «Compartir aviso»', () =>
      this.page.getByRole('button', { name: 'Compartir aviso' }).click(),
    )
  }

  pickFormat(label: 'Cuadrado' | 'Historia' | 'Imprimir') {
    return step(`Pick the «${label}» format`, () =>
      this.sheet.getByRole('button', { name: label, exact: true }).click(),
    )
  }

  zoom(value: number) {
    return step(`Zoom the photo to ×${value}`, () => this.framer.fill(String(value)))
  }

  shareImage() {
    return step('Press «Compartir imagen»', () =>
      this.sheet.getByRole('button', { name: 'Compartir imagen' }).click(),
    )
  }

  /** Presses «Descargar» and answers the file the browser saved. */
  download(): Promise<{ name: string; bytes: Buffer }> {
    return step('Download the poster', async () => {
      const [download] = await Promise.all([
        this.page.waitForEvent('download'),
        this.sheet.getByRole('button', { name: /^Descargar/ }).click(),
      ])
      return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) }
    })
  }
}

/** Width and height from a PNG's header, or null when the bytes are not a PNG. */
export function pngSize(bytes: Buffer): { width: number; height: number } | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (!bytes.subarray(0, 8).equals(signature)) return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}
