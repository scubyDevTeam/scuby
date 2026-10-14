import { useI18n } from '@i18n/react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { buttonClass } from '@ui/Button'

// «Encontré un animal» → «¿Lo tienes contigo?». The boundary between a found case and a sighting
// is custody (docs/product/05): the person answers one question and the branch is ours.
export const Route = createFileRoute('/{-$locale}/publicar/encontrado/')({ component: Custody })

function Custody() {
  const { t } = useI18n()
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-5 py-8">
      <h1 className="m-0 text-3xl font-extrabold">{t('app.found_door.title')}</h1>
      <p className="m-0 text-muted">{t('app.found_door.hint')}</p>
      <Link to="/{-$locale}/publicar/encontrado/aviso" className={buttonClass('primary')}>
        {t('app.found_door.with_me')}
      </Link>
      <Link to="/{-$locale}/publicar/encontrado/visto" className={buttonClass('outline')}>
        {t('app.found_door.only_saw')}
      </Link>
    </div>
  )
}
