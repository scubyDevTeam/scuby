// The email's one-tap links (docs/eng/comms.md · The scanner rule). Public: the token is the auth.
import { endpoint } from '../endpoint'
import { checkinLinkWire } from '../links'

export const openCheckinLink = endpoint({
  method: 'GET',
  path: '/checkin-links/:token',
  summary:
    'What an email button is: the case, the answer it carries and the state of the link. A safe ' +
    'answer («sigue perdida») is applied by this GET and comes back `applied`; a consequential ' +
    'one («ya apareció») never is — it comes back `confirm` until the POST. Opening a link again ' +
    'changes nothing (`used`); a question answered elsewhere is `already_answered`.',
  auth: 'public',
  response: checkinLinkWire,
  errors: ['not_found'],
})

export const confirmCheckinLink = endpoint({
  method: 'POST',
  path: '/checkin-links/:token',
  summary:
    'The confirm page’s one button: applies the link’s answer — the same effect as answering the ' +
    'check-in in the app, with the defaults the app would ask for («¿quién te ayudó?» → ' +
    '`unknown`, the delete’s reason → `false_alarm`, «ya no necesita ayuda» → `need_ended`). ' +
    'Single use: a link that already answered, or a question answered elsewhere, answers its ' +
    'state and acts no more.',
  auth: 'public',
  response: checkinLinkWire,
  errors: ['not_found'],
})
