import { queryOptions, useQuery } from '@tanstack/react-query'
import { type CaseDetail, parseCase, type Species, type Vertical } from '../contracts/case'
import * as readEndpoints from '../contracts/endpoints/read'
import { type Feed, parseFeed } from '../contracts/feed'
import { call } from './http'

export const caseQuery = (code: string) =>
  queryOptions<CaseDetail>({
    queryKey: ['case', code],
    queryFn: () => call(readEndpoints.getCase, { params: { code } }, parseCase),
  })

export function useCase(code: string) {
  return useQuery(caseQuery(code))
}

/** `near` is the viewer's position when the device gave one: the server decides what counts as near. */
export type FeedFilters = {
  vertical?: Vertical
  species?: Species
  near?: { lat: number; lng: number }
}

export const feedQuery = ({ near, ...filters }: FeedFilters) =>
  queryOptions<Feed>({
    queryKey: ['feed', filters, near ?? null],
    queryFn: () =>
      call(
        readEndpoints.getFeed,
        { query: { ...filters, lat: near?.lat, lng: near?.lng } },
        parseFeed,
      ),
  })

export function useFeed(filters: FeedFilters) {
  return useQuery(feedQuery(filters))
}
