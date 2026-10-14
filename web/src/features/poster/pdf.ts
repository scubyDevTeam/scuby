// The print poster as a one-page PDF (docs/product/10 §4 · «Descargar»: `print` as PDF). A PDF that
// only shows one JPEG is a few fixed objects around the image bytes, so no library is needed.

/** A4 portrait in PDF points (1/72 in). */
export const A4_POINTS = { width: 595.28, height: 841.89 }

const encoder = new TextEncoder()

/** Wraps a baseline JPEG of `width` × `height` pixels into a page that it fills edge to edge. */
export function jpegToPdf(
  jpeg: Uint8Array,
  width: number,
  height: number,
  page = A4_POINTS,
): Uint8Array {
  const content = `q ${page.width} 0 0 ${page.height} 0 0 cm /Im0 Do Q\n`
  const parts: (string | Uint8Array)[] = []
  const offsets: number[] = []
  let length = 0
  const push = (part: string | Uint8Array) => {
    parts.push(part)
    length += typeof part === 'string' ? encoder.encode(part).length : part.length
  }
  const object = (id: number, body: string | (string | Uint8Array)[]) => {
    offsets[id] = length
    push(`${id} 0 obj\n`)
    for (const piece of Array.isArray(body) ? body : [body]) push(piece)
    push('\nendobj\n')
  }

  push('%PDF-1.4\n')
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  )
  object(4, [
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    jpeg,
    '\nendstream',
  ])
  object(5, `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`)

  const xref = length
  const rows = offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
  push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${rows.join('')}`)
  push(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const out = new Uint8Array(length)
  let at = 0
  for (const part of parts) {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part
    out.set(bytes, at)
    at += bytes.length
  }
  return out
}
