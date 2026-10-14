import type { DraftError } from '@domain/shared/publish'

export const errorCopy: Record<DraftError, string> = {
  name_required: 'Dinos cómo se llama',
  species_required: 'Elige la especie',
  size_required: 'Elige el tamaño',
  photo_required: 'Agrega al menos una foto',
  place_required: 'Toca el mapa más o menos dónde fue',
  time_required: 'Dinos cuándo fue',
  time_in_the_future: 'La hora no puede ser en el futuro',
  phone_invalid: 'Revisa el número de celular',
  contact_required: 'Deja al menos una forma de contacto activa',
  whatsapp_needs_number: 'Para recibir mensajes por WhatsApp, el número debe tener WhatsApp',
}

/** The message for an error, only if it is among those being shown. */
export const messageFor = (shown: readonly DraftError[]) => (error: DraftError) =>
  shown.includes(error) ? errorCopy[error] : null
