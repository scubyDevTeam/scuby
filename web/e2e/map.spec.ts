import { expect, tags, test } from './test.ts'

test(
  'the feed map groups crowded pins, a group opens, and a pin’s card leads to its case',
  tags('@map', '@MAP-001'),
  async ({ feed, casePage, page }) => {
    await test.step('on a desktop the map groups the cases that crowd, by colour', async () => {
      // A short window: the nine cases of Medellín on a small map, where they crowd.
      await feed.onDesktop(520)
      await feed.open()
      await expect(feed.map).toHaveAttribute('data-map-ready', 'true')
      const pins = await feed.pinsOnScreen()
      const total = pins.reduce((sum, pin) => sum + (pin.count ?? 1), 0)
      // Every case of the feed is on the map, some of them inside a group.
      expect(total).toBe(9)
      expect(pins.some((pin) => (pin.count ?? 0) > 1)).toBe(true)
    })

    await test.step('tapping a group zooms into it until its cases come apart', async () => {
      await feed.tapBiggestGroup()
      const pins = await feed.pinsOnScreen()
      expect(pins.filter((pin) => pin.id).length).toBeGreaterThan(0)
    })

    await test.step('tapping a case opens its card, which leads to its page', async () => {
      const pins = await feed.pinsOnScreen()
      const code = pins.find((pin) => pin.id)?.id
      if (!code) throw new Error('no single case on screen')
      await feed.tapCasePin(code)
      await expect(feed.pinCard).toBeVisible()
      await expect(feed.pinCard).toBeFocused()
      const title = (await feed.pinCardTitle.textContent()) ?? ''
      await feed.openCaseFromPinCard()
      await expect(page).toHaveURL(new RegExp(`/c/${code}$`))
      await expect(casePage.title(title)).toBeVisible()
    })
  },
)

test(
  'a sighting’s sheet opens without a pointer and shows what the pin means',
  tags('@map', '@MAP-002'),
  async ({ casePage }) => {
    await test.step('from the timeline, by keyboard, sighting 3 opens its sheet', async () => {
      await casePage.open('7K3PQ')
      await casePage.openSightingSheet(3)
      await expect(casePage.pinSheet).toBeVisible()
      await expect(casePage.pinSheet.getByRole('heading', { name: 'Avistamiento 3' })).toBeVisible()
      await expect(
        casePage.pinSheet.getByText('«Iba hacia el parque, con collar rojo»'),
      ).toBeVisible()
      await expect(casePage.pinSheet.getByText('Reportado por alguien con cuenta')).toBeVisible()
    })

    await test.step('a stranger gets no number, only «La vi aquí también»', async () => {
      await expect(casePage.pinSheet.getByRole('link', { name: /Escribirle/ })).toHaveCount(0)
      await expect(
        casePage.pinSheet.getByRole('button', { name: 'La vi aquí también' }),
      ).toBeVisible()
    })

    await test.step('Escape closes it', async () => {
      await casePage.closePinSheet()
      await expect(casePage.pinSheet).toHaveCount(0)
    })
  },
)
