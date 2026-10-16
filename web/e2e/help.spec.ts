import { expect, tags, test } from './test.ts'

test(
  '«Yo ayudo»: a neighbour offers a ride, verifies their number and reaches whoever asks',
  tags('@help-request', '@HREQ-001'),
  async ({ help }) => {
    await test.step('a stranger opens Max’s request: what it needs, and how far each got', async () => {
      await help.open('HE7PA')
      await expect(help.title('Max')).toBeVisible()
      await expect(
        help.need('Transporte').getByText('0 de 1 confirmado · 1 prometido'),
      ).toBeVisible()
      await expect(help.text(/nadie te va a pedir dinero/)).toBeVisible()
    })

    await test.step('offering needs an account: it is born here', async () => {
      await help.offerOn('Hogar temporal')
      await help.signIn.withEmailCode('laura.diaz@correo.co')
    })

    await test.step('the offer first, then the number, then WhatsApp with Julián', async () => {
      const url = await help.offerVerifying('Puedo recibirlo dos semanas.', '300 111 2233')
      expect(url).toContain('wa.me/573000000006')
      await expect(help.safety).toBeVisible()
    })

    await test.step('back on the request: the offer is promised, not yet confirmed', async () => {
      await help.done()
      await expect(
        help.need('Hogar temporal').getByText('0 de 1 confirmado · 1 prometido'),
      ).toBeVisible()
      await expect(
        help.need('Hogar temporal').getByText(/Esperando que Julián R\. confirme/),
      ).toBeVisible()
    })
  },
)

test(
  'the beneficiary confirms what arrived; with every need covered the request closes',
  tags('@help-request', '@HREQ-002'),
  async ({ myCases, help }) => {
    await myCases.openAsDemoOwner()
    await myCases.openCase('Nala')

    await test.step('Marcela offered a home: Carolina sees her note and her number', async () => {
      await expect(
        help.offer('Marcela T.').getByText(/Puedo recibirla este fin de semana/),
      ).toBeVisible()
      await expect(help.offer('Marcela T.').getByRole('link', { name: 'Llamar' })).toBeVisible()
    })

    await test.step('only her word covers a need: «Llegó»', async () => {
      await help.confirmArrived('Marcela T.')
      await expect(help.need('Hogar temporal').getByText('Cubierto')).toBeVisible()
    })

    await test.step('the sand too, and the request closes with thanks', async () => {
      await help.coverAll()
      await expect(help.text('Nala ya tiene la ayuda que necesitaba.')).toBeVisible()
    })
  },
)
