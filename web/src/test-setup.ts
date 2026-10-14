import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { loadMessages } from './i18n/locales'
import { DEFERRED_NAMESPACES } from './i18n/namespaces'

// Screens under test read every namespace; the app fetches the deferred ones with their screens.
await loadMessages('es', DEFERRED_NAMESPACES)

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
