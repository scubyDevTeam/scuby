// Correcting a published found, adoption or help case (docs/product/00 · #27).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type EditCaseInput, editCaseBody } from '../contracts/edit'
import * as editEndpoints from '../contracts/endpoints/edit'
import { parseNothing } from '../contracts/session'
import { call } from './http'

export function useEditCase(code: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: EditCaseInput) =>
      call(editEndpoints.editCase, { params: { code }, body: editCaseBody(input) }, parseNothing),
    onSuccess: () => client.invalidateQueries(),
  })
}
