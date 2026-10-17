import { expect, tags, test } from './test.ts'

test(
  'the demo owner reads their messages, answers one, and finds a closed one read-only',
  tags('@chat', '@CHAT-001'),
  async ({ myCases, inbox, chat }) => {
    await myCases.openAsDemoOwner()
    await inbox.openFromNav()

    await test.step('«Mensajes» lists the threads: unread first, the closed one last, no numbers', async () => {
      await chat.openMessagesTab()
      await expect(chat.threads).toHaveCount(3)
      await expect(chat.threads.first()).toContainText('Andrés R.')
      await expect(chat.threads.last()).toContainText('Cerrado')
      await expect(chat.threads.first()).not.toContainText('+57')
    })

    await test.step('a thread shows the automatic evidence, then the conversation', async () => {
      await chat.openThread('Perro')
      await expect(chat.heading('Andrés R.')).toBeVisible()
      await expect(chat.messages.first()).toContainText(
        'Mensaje automático · evidencia de «Es mío»',
      )
      await expect(chat.messages.last()).toContainText('Hola, creo que es Michi.')
    })

    await test.step('answering puts the message at the end of the thread', async () => {
      await chat.send('Hola Andrés, ¿cómo se llama y desde cuándo lo buscas?')
      await expect(chat.messages.last()).toContainText('¿cómo se llama y desde cuándo lo buscas?')
    })
  },
)

test(
  'a closed conversation can be read and nothing more',
  tags('@chat', '@CHAT-002'),
  async ({ myCases, inbox, chat }) => {
    await myCases.openAsDemoOwner()
    await inbox.openFromNav()
    await chat.openMessagesTab()
    await chat.openThread('Cerrado')

    await expect(chat.messages.last()).toContainText('¡Gracias por todo!')
    await expect(chat.closedFooter).toBeVisible()
    await expect(chat.composer).toHaveCount(0)
  },
)

test(
  'writing by chat from a found case: sign in on the way, and the thread is born with the message',
  tags('@chat', '@CHAT-003'),
  async ({ casePage, chat }) => {
    await casePage.open('F8UND')
    await chat.writeButton.click()

    await test.step('without an account it asks to sign in first', async () => {
      await chat.signIn.withEmailCode('laura.diaz@correo.co')
    })

    await test.step('the first message creates the conversation', async () => {
      await chat.startFromCase('Creo que es mi gato, se llama Michi')
      await expect(chat.sent).toBeVisible()
      await chat.seeConversation()
      await expect(chat.messages.last()).toContainText('Creo que es mi gato, se llama Michi')
    })
  },
)
