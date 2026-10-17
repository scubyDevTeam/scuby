import type { Locator, Page } from '@playwright/test'
import { SignIn } from './parts.ts'
import { step } from './step.ts'

/** «Bandeja › Mensajes», one conversation, and «Escribirle por chat» on a found case. */
export class ChatPage {
  readonly page: Page
  readonly messagesTab: Locator
  readonly threads: Locator
  readonly messages: Locator
  readonly composer: Locator
  readonly closedFooter: Locator
  readonly signIn: SignIn
  /** On a found case: the button, and its sheet. */
  readonly writeButton: Locator
  readonly firstMessage: Locator
  readonly sent: Locator

  constructor(page: Page) {
    this.page = page
    this.messagesTab = page.getByRole('navigation', { name: 'Bandeja' }).getByRole('link', {
      name: 'Mensajes',
    })
    this.threads = page.getByRole('list', { name: 'Conversaciones' }).getByRole('listitem')
    this.messages = page.getByRole('list', { name: 'Mensajes' }).getByRole('listitem')
    this.composer = page.getByRole('textbox', { name: 'Escribe un mensaje' })
    this.closedFooter = page.getByText('Este caso terminó; la conversación queda solo para leer.')
    this.signIn = new SignIn(page)
    this.writeButton = page.getByRole('button', { name: 'Escribirle por chat' })
    this.firstMessage = page.getByRole('textbox', { name: 'Tu mensaje' })
    this.sent = page.getByText('Mensaje enviado')
  }

  thread(text: string | RegExp) {
    return this.threads.filter({ hasText: text })
  }

  heading(name: string) {
    return this.page.getByRole('heading', { name })
  }

  openMessagesTab() {
    return step('Open the «Mensajes» tab', () => this.messagesTab.click())
  }

  openThread(text: string | RegExp) {
    return step(`Open the conversation «${text}»`, () =>
      this.thread(text).getByRole('link').click(),
    )
  }

  send(text: string) {
    return step(`Send «${text}»`, async () => {
      await this.composer.fill(text)
      await this.page.getByRole('button', { name: 'Enviar', exact: true }).click()
    })
  }

  /** On the found case: write by chat, signing in on the way when there is no account. */
  startFromCase(text: string) {
    return step('Write the first message from the case', async () => {
      await this.firstMessage.fill(text)
      await this.page.getByRole('button', { name: 'Enviar mensaje' }).click()
    })
  }

  seeConversation() {
    return step('Open the conversation just started', () =>
      this.page.getByRole('link', { name: 'Ver la conversación' }).click(),
    )
  }
}
