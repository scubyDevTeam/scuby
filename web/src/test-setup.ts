import { cleanup, configure } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { loadMessages } from './i18n/locales'
import { DEFERRED_NAMESPACES } from './i18n/namespaces'

// Screens under test read every namespace; the app fetches the deferred ones with their screens.
await loadMessages('es', DEFERRED_NAMESPACES)

// A full run starts ~90 files at once: a screen's first render can take longer than the 1 s
// default while every worker loads. A real wait is still a wait; only a hung one fails.
configure({ asyncUtilTimeout: 4000 })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
