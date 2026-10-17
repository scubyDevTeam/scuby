import { expect, tags, test } from './test.ts'

test(
  '«Es mío»: sign in on the way, offer proof, and reach whoever has the animal',
  tags('@found', '@FOUND-001'),
  async ({ casePage }) => {
    await test.step('a stranger opens the found cat', async () => {
      await casePage.open('F8UND')
      await expect(casePage.title('Gato negro, pequeño')).toBeVisible()
      await expect(casePage.found).toBeVisible()
    })

    await test.step('«es mío» is never anonymous: the account is born here', async () => {
      await casePage.claimOwnership()
      await casePage.signIn.withEmailCode('laura.diaz@correo.co')
    })

    await test.step('the proof goes out and WhatsApp opens with the custodian', async () => {
      expect(
        await casePage.sendOwnershipClaim('Tiene una mancha blanca en la pata trasera'),
      ).toContain('wa.me')
      await expect(casePage.possibleOwner).toBeVisible()
    })
  },
)

test(
  'the custodian checks a claim against what they withheld and hands the animal over',
  tags('@found', '@FOUND-002'),
  async ({ myCases, casePage }) => {
    await myCases.openAsDemoOwner()
    await myCases.openCase('Perro café, mediano')

    await test.step('the claim sits next to the detail the custodian kept back', async () => {
      const claims = casePage.ownershipClaims
      await expect(claims.getByText('Guardaste: «Collar verde con una campana».')).toBeVisible()
      await expect(claims.getByText('«Tiene un collar verde con campanita»')).toBeVisible()
    })

    await test.step('confirming the owner suggests how they found each other', async () => {
      await casePage.confirmOwner()
      await expect(casePage.choice('Su dueño lo vio aquí y me escribió')).toBeChecked()
    })

    await test.step('the hand-over closes the case', async () => {
      await casePage.handOver()
      await expect(casePage.text('Ya está con su familia.')).toBeVisible()
      await expect(casePage.backWithOwner).toHaveCount(0)
    })
  },
)

test(
  'fifteen days with no owner: the custodian keeps the animal',
  tags('@found', '@FOUND-003'),
  async ({ myCases, casePage }) => {
    await myCases.openAsDemoOwner()
    await myCases.openCase('Perro café, mediano')

    await casePage.keepIt()

    await test.step('the animal has a home', async () => {
      await expect(casePage.text('Ya tiene hogar.')).toBeVisible()
    })
  },
)

test(
  'the custodian answers «¿sigues con él?» with one tap',
  tags('@found', '@FOUND-004'),
  async ({ myCases, casePage }) => {
    await myCases.openAsDemoOwner()
    await myCases.openCase('Perro café, mediano')

    await test.step('the question waits on the case', async () => {
      await expect(casePage.foundCheckin).toBeVisible()
    })

    await test.step('«Sigo con él» answers it and it goes away', async () => {
      await casePage.answerStillHolding()
      await expect(casePage.foundCheckin).toHaveCount(0)
    })
  },
)
