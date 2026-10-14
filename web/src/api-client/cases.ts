import { queryOptions, useQuery } from '@tanstack/react-query'
import { type CaseDetail, parseCase, type Species, type Vertical } from '../contracts/case'
import { type Feed, parseFeed } from '../contracts/feed'
import { apiGet } from './http'

export const caseQuery = (code: string) =>
  queryOptions<CaseDetail>({
    queryKey: ['case', code],
    queryFn: () => apiGet(`/cases/${encodeURIComponent(code)}`, parseCase),
  })

export function useCase(code: string) {
  return useQuery(caseQuery(code))
}

export type FeedFilters = { vertical?: Vertical; species?: Species }

export const feedQuery = (filters: FeedFilters) =>
  queryOptions<Feed>({
    queryKey: ['feed', filters],
    queryFn: () => apiGet('/feed', parseFeed, filters),
  })

export function useFeed(filters: FeedFilters) {
  return useQuery(feedQuery(filters))
}
