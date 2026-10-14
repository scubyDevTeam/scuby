import type { DraftError } from '@domain/shared/publish'
import type { TextKey, Translator } from '@i18n/translate'

export const draftErrorKey: Record<DraftError, TextKey> = {
  name_required: 'publish.errors.name_required',
  species_required: 'publish.errors.species_required',
  size_required: 'publish.errors.size_required',
  photo_required: 'publish.errors.photo_required',
  place_required: 'publish.errors.place_required',
  time_required: 'publish.errors.time_required',
  time_in_the_future: 'publish.errors.time_in_the_future',
  phone_invalid: 'contact.phone_invalid',
  contact_required: 'publish.errors.contact_required',
  whatsapp_needs_number: 'publish.errors.whatsapp_needs_number',
}

/** The message for an error, only if it is among those being shown. */
export const messageFor =
  (t: Translator['t'], shown: readonly DraftError[]) => (error: DraftError) =>
    shown.includes(error) ? t(draftErrorKey[error]) : null
