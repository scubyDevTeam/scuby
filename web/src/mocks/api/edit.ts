// Correcting a published found, adoption or help case (docs/product/00 · #27): active only, its
// publisher only, and nothing is re-broadcast.
import { api } from '../../contracts/api'
import { db, findCase } from '../db'
import { Fail, fail, route } from '../route'

export const edit = [
  route(api.editCase, ({ params, user, body }) => {
    const row = findCase(params.code) ?? fail('not_found')
    if (row.vertical === 'lost' || row.created_by !== user.id) {
      if (row.vertical === 'lost') fail('not_found')
      fail('forbidden')
    }
    if (row.status !== 'active') fail('invalid_transition')
    // What this vertical has no use for is refused, naming the field.
    const unused: string[] = []
    if (row.vertical === 'found' && body.story !== undefined) unused.push('story')
    if (row.vertical !== 'adoption') {
      if (body.temperament !== undefined) unused.push('temperament')
      if (body.requirements !== undefined) unused.push('requirements')
    }
    if (row.vertical === 'adoption' && body.marks !== undefined) unused.push('marks')
    if (unused.length > 0) {
      throw new Fail(
        'validation_failed',
        undefined,
        Object.fromEntries(unused.map((f) => [f, 'Not editable here'])),
      )
    }
    const animal = db.pets.find((p) => p.id === row.pet_id)
    if (body.photo_urls !== undefined && animal) animal.photo_urls = body.photo_urls
    if (body.marks !== undefined && animal) animal.marks = body.marks
    if (body.story !== undefined && (row.vertical === 'adoption' || row.vertical === 'help')) {
      row.story = body.story
    }
    if (row.vertical === 'adoption') {
      if (body.temperament !== undefined) row.temperament = body.temperament
      if (body.requirements !== undefined) row.requirements = body.requirements
    }
    return null
  }),
]
