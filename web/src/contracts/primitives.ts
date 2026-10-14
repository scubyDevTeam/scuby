// The value shapes every endpoint shares. Wire names are snake_case; times are ISO 8601 with an offset.
import * as z from 'zod/mini'

export const point = z.object({
  lat: z.number().check(z.gte(-90), z.lte(90)),
  lng: z.number().check(z.gte(-180), z.lte(180)),
})
export const timestamp = z.iso.datetime({ offset: true })
/** E.164. Format-validated when collected; the publisher's number is also verified by SMS. */
export const phone = z.string().check(z.regex(/^\+[1-9]\d{6,14}$/))
/** A URL the upload endpoint returned. */
export const photoUrl = z.string().check(z.minLength(1))

export const verticalSchema = z.enum(['lost', 'found', 'adoption', 'help'])
export const speciesSchema = z.enum(['dog', 'cat', 'other'])
export const sizeSchema = z.enum(['small', 'medium', 'large'])
/** A coat colour is a key, never a word: each language names it (docs/eng/frontend.md · Languages). */
export const colorSchema = z.enum(['black', 'white', 'brown', 'tan', 'gray', 'yellow', 'orange'])

export const contactPrefs = z.object({
  expose_whatsapp: z.boolean(),
  expose_email: z.boolean(),
  in_app_only: z.boolean(),
})

/** What a write answers when the caller only needs to know it happened. */
export const createdWire = z.object({ id: z.string() })

export type Point = z.infer<typeof point>
export type Vertical = z.infer<typeof verticalSchema>
export type Species = z.infer<typeof speciesSchema>
export type PetSize = z.infer<typeof sizeSchema>
export type Color = z.infer<typeof colorSchema>
