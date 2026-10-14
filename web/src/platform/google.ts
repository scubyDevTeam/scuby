// Google Identity Services, loaded only when someone taps «Continuar con Google».
const SCRIPT = 'https://accounts.google.com/gsi/client'

type Gsi = {
  accounts: {
    id: {
      initialize: (options: {
        client_id: string
        callback: (r: { credential?: string }) => void
      }) => void
      prompt: (
        onMoment: (moment: { isNotDisplayed(): boolean; isSkippedMoment(): boolean }) => void,
      ) => void
    }
  }
}

function load(): Promise<Gsi | null> {
  return new Promise((resolve) => {
    const existing = (window as { google?: Gsi }).google
    if (existing) return resolve(existing)
    const script = document.createElement('script')
    script.src = SCRIPT
    script.async = true
    script.onload = () => resolve((window as { google?: Gsi }).google ?? null)
    script.onerror = () => resolve(null)
    document.head.append(script)
  })
}

/** The ID token Google hands back, or null when the prompt was closed or could not be shown. */
export async function requestGoogleCredential(clientId: string): Promise<string | null> {
  const google = await load()
  if (!google) return null
  return new Promise((resolve) => {
    google.accounts.id.initialize({
      client_id: clientId,
      callback: (response) => resolve(response.credential ?? null),
    })
    google.accounts.id.prompt((moment) => {
      if (moment.isNotDisplayed() || moment.isSkippedMoment()) resolve(null)
    })
  })
}
