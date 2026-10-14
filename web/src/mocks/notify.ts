// The in-app inbox gets a copy of every notification (docs/product/08 · Global rules). Push and
// email are the real backend's; the emulation only fills the inbox.
import { db, newId } from './db'
import { iso } from './rules'

export function notify(personId: string | null, event: string, body: string, caseCode: string) {
  if (!personId) return
  db.notifications.push({
    id: newId('n-'),
    person_id: personId,
    event,
    body,
    case_code: caseCode,
    created_at: iso(Date.now()),
    read_at: null,
  })
}
