import { WitnessReport } from '@features/found/WitnessReport'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { env } from '../../env'
import { needsWords } from '../-i18n'

// No account: a witness report must be as cheap to file as possible.
export const Route = createFileRoute('/{-$locale}/publicar/encontrado/visto')({
  beforeLoad: needsWords('publish'),
  component: Witness,
})

function Witness() {
  const navigate = useNavigate()
  return (
    <WitnessReport mapStyleUrl={env.mapStyleUrl} onDone={() => navigate({ to: '/{-$locale}' })} />
  )
}
