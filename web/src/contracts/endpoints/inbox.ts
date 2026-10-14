// The in-app inbox (docs/product/08).
import { endpoint } from '../endpoint'
import { notificationsWire, readNotificationsRequest } from '../inbox'

export const listNotifications = endpoint({
  method: 'GET',
  path: '/me/notifications',
  summary: 'The in-app inbox, newest first: a copy of every notification sent to this account.',
  auth: 'session',
  response: notificationsWire,
})

export const readNotifications = endpoint({
  method: 'POST',
  path: '/me/notifications/read',
  summary: 'Marks notifications as read: the ones named, or all of them.',
  auth: 'session',
  body: readNotificationsRequest,
})
