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
