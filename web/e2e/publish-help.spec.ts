import { expect, tags, test } from './test.ts'

test(
  'ask for help in kind for a pet you have: a ride and food, never money',
  tags('@publish-help', '@PHELP-001'),
  async ({ publish, help }) => {
    await test.step('«Pedir ayuda» asks for an account, then for which pet', async () => {
      await publish.open()
      await publish.chooseHelp()
      await publish.signIn.withGoogle()
      await publish.helpFor('Luna')
      await publish.next()
    })

    await test.step('one to three things, each saying exactly what', async () => {
      await publish.ask('Transporte', 'A la veterinaria de Laureles el sábado en la mañana')
      await publish.ask('Insumos', 'Concentrado para perro pequeño')
      await publish.next()
    })

    await test.step('where, what happened, the phone step — and it is live, unverified', async () => {
      await publish.map.mark()
      await publish.tellNeighbours('Luna se lastimó una pata y no tengo carro para llevarla.')
      await publish.phone.publishVerifying('300 715 2284', undefined, 'Publicar solicitud')
      await expect(help.text('¡Solicitud publicada!')).toBeVisible()
      await help.page.getByRole('link', { name: 'Ver mi solicitud' }).click()
      await expect(help.title('Luna')).toBeVisible()
      await expect(
        help.text('Sin verificar — la plataforma no ha revisado quién pide.'),
      ).toBeVisible()
      await expect(help.need('Transporte')).toBeVisible()
    })
  },
)

test(
  'the custodian of a found dog asks for food for it, from its case',
  tags('@publish-help', '@PHELP-002'),
  async ({ myCases, casePage, publish, help }) => {
    await myCases.openAsDemoOwner()
    await myCases.openCase('Perro café, mediano')
    await casePage.askHelpForFound()

    await test.step('the animal is already described: straight to what it needs', async () => {
      await expect(help.text('Para el animal que encontraste')).toBeVisible()
      await publish.next()
      await publish.ask('Insumos', 'Concentrado para perro mediano')
      await publish.next()
    })

    await test.step('where (where it was found) and the story, then it is live', async () => {
      await publish.tellNeighbours('Lo cuido mientras aparece su familia.')
      await publish.phone.publishVerifying('300 715 2284', undefined, 'Publicar solicitud')
      await expect(help.text('¡Solicitud publicada!')).toBeVisible()
    })
  },
)
