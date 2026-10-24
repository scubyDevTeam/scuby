// The emulated bucket (docs/eng/infra.md · Media): the upload slot's PUT target and the photo's
// URL are one address keyed by the photo's hash, as the real master is `media/{sha256}.jpg`.
// Bytes are kept as data URLs in the tables, so they live and die with the rest of the emulation.
import { HttpResponse, http } from 'msw'
import { env } from '../../env'
import { db, persist } from '../db'

const PATH = '/mock-media'

export const mediaUrl = (sha256: string) => new URL(`${PATH}/${sha256}.jpg`, env.apiUrl).toString()

const hashOf = (file: unknown) => String(file).replace(/\.jpg$/, '')

export const media = [
  http.put(new URL(`${PATH}/:file`, env.apiUrl).toString(), async ({ request, params }) => {
    const bytes = new Uint8Array(await request.arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    db.media[hashOf(params.file)] = `data:image/jpeg;base64,${btoa(binary)}`
    persist()
    return new HttpResponse(null, { status: 200 })
  }),
  http.get(new URL(`${PATH}/:file`, env.apiUrl).toString(), ({ params }) => {
    const stored = db.media[hashOf(params.file)]
    if (!stored) return new HttpResponse(null, { status: 404 })
    const [, base64 = ''] = stored.split(',')
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    return new HttpResponse(bytes, { headers: { 'content-type': 'image/jpeg' } })
  }),
]
