import { expect, tags, test } from './test.ts'

test(
  'edit the name, the city, the bio and a notification toggle, and find them after a reload',
  tags('@profile', '@PROFILE-001'),
  async ({ profile }) => {
    await test.step('the profile opens with what the account has', async () => {
      await profile.open()
      await profile.signIn.withEmailCode('ana.gomez@correo.co')
      await expect(profile.name('Ana Gomez')).toBeVisible()
      await expect(profile.email('ana.gomez@correo.co')).toBeVisible()
      await expect(profile.notification('Adopción')).toBeChecked()
    })

    await test.step('the changes are saved', async () => {
      await profile.editName('Ana María Gómez')
      await profile.editCity('Envigado')
      await profile.editBio('Rescatista de gatos en Envigado.')
      await profile.toggleNotification('Adopción')
      await profile.save()
      await expect(profile.saved).toBeVisible()
      await expect(profile.name('Ana María Gómez')).toBeVisible()
    })

    await test.step('they are still there after a reload', async () => {
      await profile.reload()
      await expect(profile.name('Ana María Gómez')).toBeVisible()
      await expect(profile.cityField).toHaveValue('Envigado')
      await expect(profile.bioField).toHaveValue('Rescatista de gatos en Envigado.')
      await expect(profile.notification('Adopción')).not.toBeChecked()
    })
  },
)

test(
  'turn on «Mascotas perdidas cerca de mí»: confirm the zone, find it after a reload, turn it off',
  tags('@profile', '@PROFILE-002'),
  async ({ profile }) => {
    await profile.open()
    await profile.signIn.withEmailCode('ana.gomez@correo.co')

    await test.step('it starts off, with the offer', async () => {
      await expect(profile.alertsOffer).toBeVisible()
    })

    await test.step('marking the zone and a radius turns it on', async () => {
      await profile.activateAlerts(5)
      await expect(profile.alertsOn).toContainText('unos 5 km')
    })

    await test.step('the zone is still there after a reload', async () => {
      await profile.reload()
      await expect(profile.alertsOn).toBeVisible()
    })

    await test.step('turning it off brings back the offer', async () => {
      await profile.turnOffAlerts()
      await expect(profile.alertsOffer).toBeVisible()
    })
  },
)

test(
  'delete the account: it asks once, then the session ends and the account is gone',
  tags('@profile', '@PROFILE-003'),
  async ({ profile }) => {
    await profile.open()
    await profile.signIn.withEmailCode('borrar.cuenta@correo.co')
    await expect(profile.name('Borrar Cuenta')).toBeVisible()

    await profile.deleteAccount()

    await test.step('the session ended: the profile asks to sign in again', async () => {
      await expect(profile.signIn.title).toBeVisible()
    })
  },
)

test(
  'add a verified phone from the profile, with its SMS code',
  tags('@profile', '@PROFILE-004'),
  async ({ profile }) => {
    await profile.open()
    await profile.signIn.withEmailCode('celular.nuevo@correo.co')

    await profile.changePhone('300 999 8877')

    await test.step('the number is verified and stays after a reload', async () => {
      await expect(profile.phoneVerified).toBeVisible()
      await profile.reload()
      await expect(profile.email('+573009998877')).toBeVisible()
    })
  },
)
