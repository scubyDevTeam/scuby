// Wire answers of the chat for component tests (src/features/chat): the same shapes the emulated backend sends.
const MINUTE = 60_000
export const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * MINUTE).toISOString()

export const listAnswer = {
  unread_count: 2,
  items: [
    {
      id: 'c-1',
      case_code: 'C4STD',
      other_name: 'Andrés R.',
      photo_url: null,
      topic: 'Gatito negro · reclamo «Es mío»',
      preview: 'Tiene unas canas blancas en el pecho',
      last_at: at(12),
      unread_count: 2,
      closed: false,
    },
    {
      id: 'c-2',
      case_code: 'R3SCU',
      other_name: 'Marta G.',
      photo_url: null,
      topic: 'Rocky · caso cerrado',
      preview: '¡Gracias por todo!',
      last_at: at(60 * 24 * 5),
      unread_count: 0,
      closed: true,
    },
  ],
}

const message = (id: string, fields: Record<string, unknown>) => ({
  id,
  kind: 'text',
  label: null,
  body: '',
  photo_urls: [],
  phone: null,
  whatsapp_url: null,
  mine: false,
  sent_at: at(30),
  ...fields,
})

export const threadAnswer = (fields: Record<string, unknown> = {}) => ({
  id: 'c-1',
  other_name: 'Andrés R.',
  case: {
    code: 'C4STD',
    vertical: 'found',
    pet_name: 'Gatito negro',
    photo_url: null,
    summary: 'Reclamo «Es mío» · hace 12 min',
  },
  closed: null,
  can_share_whatsapp: true,
  messages: [
    message('m-1', {
      kind: 'automatic',
      label: 'Mensaje automático · evidencia de «Es mío»',
      body: 'Lo que dijo: «collar verde».',
      sent_at: at(40),
    }),
    message('m-2', { body: 'Hola, creo que es Michi.', sent_at: at(30) }),
    message('m-3', {
      body: '¿Cómo se llama y desde cuándo lo buscas?',
      mine: true,
      sent_at: at(25),
    }),
    message('m-4', {
      kind: 'whatsapp',
      phone: '+573000000001',
      whatsapp_url: 'https://wa.me/573000000001',
      sent_at: at(20),
    }),
  ],
  ...fields,
})
