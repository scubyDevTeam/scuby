// Correcting a published case (design «Aviso · editar»; docs/product/00 · #27). One entry for the
// verticals that are not «lost» (which also moves a zone and a time: `editLost`). Fields a vertical
// has no use for are `validation_failed`; fields left out stay as they are; never re-broadcasts.
import * as z from 'zod/mini'
import { temperamentSchema } from './adoption'
import { photoUrl } from './primitives'

export const editCaseRequest = z.object({
  photo_urls: z.optional(z.array(photoUrl).check(z.minLength(1), z.maxLength(6))),
  /** Found, adoption and help: the pet's signs. */
  marks: z.optional(z.nullable(z.string().check(z.maxLength(500)))),
  /** Adoption and help: the story the page tells. */
  story: z.optional(z.string().check(z.minLength(1), z.maxLength(2000))),
  /** Adoption only. */
  temperament: z.optional(z.array(temperamentSchema)),
  requirements: z.optional(z.nullable(z.string().check(z.maxLength(500)))),
})

export type EditCaseInput = {
  photoUrls?: string[]
  marks?: string | null
  story?: string
  temperament?: z.infer<typeof temperamentSchema>[]
  requirements?: string | null
}

export const editCaseBody = (input: EditCaseInput): z.input<typeof editCaseRequest> => ({
  ...(input.photoUrls !== undefined ? { photo_urls: input.photoUrls } : {}),
  ...(input.marks !== undefined ? { marks: input.marks } : {}),
  ...(input.story !== undefined ? { story: input.story } : {}),
  ...(input.temperament !== undefined ? { temperament: input.temperament } : {}),
  ...(input.requirements !== undefined ? { requirements: input.requirements } : {}),
})
