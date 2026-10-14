import { describe, expect, it } from 'vitest'
import { answerFor, notificationFor, parsePayload } from './push'

const checkinPush = {
  title: 'Luna',
  body: '¿Luna sigue perdida?',
  url: '/c/7K3PQ',
  tag: 'checkin-ck-1',
  checkin: {
    code: '7K3PQ',
    id: 'ck-1',
    actions: [
      { response: 'still_lost', title: 'Sigue perdida' },
      { response: 'reunited', title: 'Ya apareció' },
    ],
  },
}

describe('service worker — comms.md · Actionable check-ins, push surface', () => {
  it('shows the check-in with its answers as buttons, words as the backend wrote them', () => {
    const payload = parsePayload(checkinPush)
    expect(payload).not.toBeNull()
    const options = notificationFor(payload!, '/brand/icon-192.png')
    expect(options).toMatchObject({ body: '¿Luna sigue perdida?', tag: 'checkin-ck-1' })
    expect(options.actions).toEqual([
      { action: 'still_lost', title: 'Sigue perdida' },
      { action: 'reunited', title: 'Ya apareció' },
    ])
  })

  it('a button answers that check-in', () => {
    const { data } = notificationFor(parsePayload(checkinPush)!, '')
    expect(answerFor(data, 'reunited')).toEqual({
      code: '7K3PQ',
      checkinId: 'ck-1',
      response: 'reunited',
    })
  })

  it('a tap on the body answers nothing: it opens the case (the iOS deep-link path)', () => {
    const { data } = notificationFor(parsePayload(checkinPush)!, '')
    expect(answerFor(data, '')).toBeNull()
    expect(data.url).toBe('/c/7K3PQ')
  })

  it('a plain notification has no buttons', () => {
    const payload = parsePayload({ title: 'Luna', body: 'Alguien vio a Luna.', url: '/c/7K3PQ' })
    const options = notificationFor(payload!, '')
    expect(options.actions).toEqual([])
    expect(answerFor(options.data, 'still_lost')).toBeNull()
  })

  it.each([
    ['no url', { title: 'x', body: 'y' }],
    ['a url off this site', { title: 'x', body: 'y', url: 'https://elsewhere.test/' }],
    ['a protocol-relative url', { title: 'x', body: 'y', url: '//elsewhere.test/' }],
    ['a backslash url', { title: 'x', body: 'y', url: '/\\elsewhere.test/' }],
    [
      'an answer the contract does not know',
      {
        ...checkinPush,
        checkin: { ...checkinPush.checkin, actions: [{ response: 'maybe', title: 'Quizá' }] },
      },
    ],
    ['not JSON at all', null],
  ])('ignores a payload with %s', (_, raw) => {
    expect(parsePayload(raw)).toBeNull()
  })
})
