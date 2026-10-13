import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { brand } from './brand'

// Placeholder until the router lands (frontend-plan step 0.3).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main>
      <h1>{brand.name}</h1>
    </main>
  </StrictMode>,
)
