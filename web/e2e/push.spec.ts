import { expect, tags, test } from './test.ts'

test(
  'after publishing, the owner turns on alerts and this phone is registered for Web Push',
  tags('@push', '@PUSH-001'),
  async ({ publish, push }) => {
    await test.step('an Android phone whose browser can do Web Push', async () => {
      await push.browserSaysYes()
    })

    await test.step('the owner publishes a lost pet', async () => {
      await publish.open()
      await publish.chooseLost()
      await publish.signIn.withEmailCode('ana.gomez@correo.co')
      await publish.name('Kira')
      await publish.photos.add('kira.png')
      await publish.describe({ species: 'Perro', size: 'Mediano' })
      await publish.next()
      await publish.map.mark()
      await publish.when('Ayer')
      await publish.phone.publishVerifying('300 715 2284')
    })

    await test.step('the case is live and alerts are offered — nothing was asked on its own', async () => {
      await expect(publish.published.title).toBeVisible()
      await expect(push.offer).toBeVisible()
      expect(await push.permissionPrompts()).toBe(0)
    })

    await test.step('turning them on registers this install as webpush', async () => {
      const sent = await push.enable()
      expect(sent.kind).toBe('webpush')
      expect(JSON.parse(sent.token)).toMatchObject({ endpoint: 'https://push.example.test/e2e' })
      await expect(push.done).toBeVisible()
      expect(await push.permissionPrompts()).toBe(1)
    })
  },
)
