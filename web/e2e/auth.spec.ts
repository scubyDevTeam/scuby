import { expect, tags, test } from './test.ts'

test(
  'sign in with an emailed code, land where you were going, and sign out',
  tags('@auth', '@AUTH-001'),
  async ({ profile }) => {
    await test.step('the profile asks who you are', async () => {
      await profile.open()
      await expect(profile.signIn.title).toBeVisible()
    })

    await test.step('the emailed code signs you in, back on the profile', async () => {
      await profile.signIn.withEmailCode('juan.perez@correo.co')
      await expect(profile.name('Juan Perez')).toBeVisible()
      await expect(profile.email('juan.perez@correo.co')).toBeVisible()
    })

    await test.step('the session outlives a reload', async () => {
      await profile.reload()
      await expect(profile.name('Juan Perez')).toBeVisible()
    })

    await test.step('signing out asks again', async () => {
      await profile.signOut()
      await expect(profile.signIn.title).toBeVisible()
    })
  },
)

test('sign in with Google', tags('@auth', '@AUTH-002'), async ({ myCases }) => {
  await myCases.open()
  await myCases.signIn.withGoogle()

  await test.step('the page you were going to opens', async () => {
    await expect(myCases.title).toBeVisible()
  })
})
