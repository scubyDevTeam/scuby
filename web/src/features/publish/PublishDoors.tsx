import { Notice } from '@ui/Notice'
import { Eye, HeartHandshake, Home, Search } from 'lucide-react'
import type { ReactNode } from 'react'

export type Door = 'lost' | 'found' | 'adoption' | 'help'

const doors: {
  door: Door
  title: string
  text: string
  className: string
  icon: ReactNode
  urgent: boolean
}[] = [
  {
    door: 'lost',
    title: 'Perdí a mi mascota',
    text: 'Avisamos a los vecinos de la zona.',
    className: 'bg-lost',
    icon: <Search aria-hidden="true" className="size-8" />,
    urgent: true,
  },
  {
    door: 'found',
    title: 'Encontré un animal',
    text: 'Lo tengas contigo o solo lo hayas visto.',
    className: 'bg-found',
    icon: <Eye aria-hidden="true" className="size-8" />,
    urgent: true,
  },
  {
    door: 'adoption',
    title: 'Dar en adopción',
    text: 'Un animal que tienes y busca hogar.',
    className: 'bg-adoption',
    icon: <Home aria-hidden="true" className="size-8" />,
    urgent: false,
  },
  {
    door: 'help',
    title: 'Pedir ayuda',
    text: 'Una campaña para un gasto puntual.',
    className: 'bg-help',
    icon: <HeartHandshake aria-hidden="true" className="size-8" />,
    urgent: false,
  },
]

/**
 * The four ways in. Only the owner publishes a lost case (docs/product/04 · Publishing): someone
 * who saw or holds an animal goes through «Encontré un animal».
 */
export function PublishDoors({
  link,
}: {
  link: (door: Door, children: ReactNode, className: string) => ReactNode
}) {
  const card = (entry: (typeof doors)[number]) => (
    <li key={entry.door}>
      {link(
        entry.door,
        <>
          {entry.icon}
          <span>
            <span className="block text-xl font-extrabold">{entry.title}</span>
            <span className="block">{entry.text}</span>
          </span>
        </>,
        `flex min-h-20 items-center gap-4 rounded-2xl p-5 text-white no-underline ${entry.className}`,
      )}
    </li>
  )
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-5 py-8">
      <h1 className="m-0 text-3xl font-extrabold">¿Qué pasó?</h1>
      <p className="m-0 text-muted">Elige lo que mejor describe tu situación.</p>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {doors.filter((d) => d.urgent).map(card)}
      </ul>
      <h2 className="m-0 mt-2 text-sm font-bold tracking-widest text-muted uppercase">
        Sin urgencia
      </h2>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {doors.filter((d) => !d.urgent).map(card)}
      </ul>
      <Notice title="¿Solo viste un animal en la calle?">
        Entra por «Encontré un animal»: reportarlo toma un toque y no necesitas cuenta.
      </Notice>
    </div>
  )
}
