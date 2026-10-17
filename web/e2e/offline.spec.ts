import { expect, tags, test } from './test.ts'

// The one second e2e a feature gets (frontend.md · Testing): only a real browser has a reload, an
// offline mode and storage that outlives the page. How «no signal» is simulated: e2e/pages/Signal.ts.
test(
  '«La vi» with no signal: kept on the phone, through a reload, and sent once the signal is back',
  tags('@offline', '@OFFLINE-001'),
  async ({ casePage }) => {
    const note = 'Cruzando la 80, sin señal'

    await test.step('Luna has three sightings', async () => {
      await casePage.open('7K3PQ')
      await expect(casePage.sightings).toHaveCount(3)
    })

    await casePage.startSighting(note)
    await casePage.signal.lose()
    await casePage.sendSighting()

    await test.step('no error: the form says it kept the sighting and will send it', async () => {
      await expect(casePage.keptTitle).toBeVisible()
      await expect(casePage.text('Sin conexión')).toBeVisible()
    })

    await casePage.backToCase()

    await test.step('the page shows it «En espera», and not yet on the trail', async () => {
      await expect(casePage.queued).toHaveCount(1)
      await expect(casePage.queued.first()).toContainText('En espera')
      await expect(casePage.sightings).toHaveCount(3)
    })

    await casePage.signal.reopenWithoutSignal('/c/7K3PQ')

    await test.step('reopened with still no signal, it is still waiting', async () => {
      await expect(casePage.title('Luna')).toBeVisible()
      await expect(casePage.queued).toHaveCount(1)
      await expect(casePage.queued.first()).toContainText('En espera')
      await expect(casePage.sightings).toHaveCount(3)
    })

    await casePage.signal.restore()

    await test.step('with the signal back it joins the trail — once — and stops waiting', async () => {
      await expect(casePage.sightings).toHaveCount(4)
      await expect(casePage.sightings.filter({ hasText: note })).toHaveCount(1)
      await expect(casePage.queued).toHaveCount(0)
    })
  },
)
