// What anyone reads (docs/product/04, 05, 10).
import { caseWire } from '../case'
import { configWire } from '../config'
import { endpoint } from '../endpoint'
import { feedQuerySchema, feedWire } from '../feed'

export const getConfig = endpoint({
  method: 'GET',
  path: '/config',
  summary: 'The countries the product runs in.',
  auth: 'public',
  response: configWire,
})

export const getCase = endpoint({
  method: 'GET',
  path: '/cases/:code',
  summary:
    'A case by its short code. The same URL answers more to the person responsible for it ' +
    '(`viewer`): claims, hidden pins, reporters’ numbers, the pending check-in, the withheld detail.',
  auth: 'public',
  response: caseWire,
  errors: ['not_found', 'gone'],
})

export const getFeed = endpoint({
  method: 'GET',
  path: '/feed',
  summary: 'Open cases, newest first: near `lat`/`lng`, or the whole country when nothing is near.',
  auth: 'public',
  query: feedQuerySchema,
  response: feedWire,
})
