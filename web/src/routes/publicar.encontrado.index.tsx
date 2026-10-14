import { createFileRoute, Link } from '@tanstack/react-router'
import { buttonClass } from '@ui/Button'

// «Encontré un animal» → «¿Lo tienes contigo?». The boundary between a found case and a sighting
// is custody (docs/product/05): the person answers one question and the branch is ours.
export const Route = createFileRoute('/publicar/encontrado/')({
  component: () => (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-5 py-8">
      <h1 className="m-0 text-3xl font-extrabold">¿Lo tienes contigo?</h1>
      <p className="m-0 text-muted">Así sabemos cómo ayudarte mejor.</p>
      <Link to="/publicar/encontrado/aviso" className={buttonClass('primary')}>
        Sí, lo tengo conmigo
      </Link>
      <Link to="/publicar/encontrado/visto" className={buttonClass('outline')}>
        No, solo lo vi
      </Link>
    </div>
  ),
})
