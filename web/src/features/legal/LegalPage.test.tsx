// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LegalPage } from './LegalPage'

const other = (children: React.ReactNode) => <a href="/otro">{children}</a>

describe('03 · What we must ship at launch', () => {
  it('the terms say we are an intermediary, and that the text is a draft', () => {
    render(<LegalPage document="terms" contactEmail={undefined} otherLink={other} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Términos y condiciones' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Facilitamos el contacto, nada más' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'El dinero nunca pasa por aquí' })).toBeTruthy()
    expect(screen.getByText('Borrador')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Política de tratamiento de datos' })).toBeTruthy()
  })

  it('the data policy names the rights channel when it is configured', () => {
    render(<LegalPage document="privacy" contactEmail="datos@example.org" otherLink={other} />)
    const mail = screen.getAllByRole('link', { name: 'datos@example.org' })
    expect(mail.length).toBeGreaterThan(0)
    expect(mail[0]?.getAttribute('href')).toBe('mailto:datos@example.org')
    expect(screen.getByRole('heading', { name: 'Tus derechos' })).toBeTruthy()
  })

  it('says a channel is coming while none is configured, never a fake address', () => {
    render(<LegalPage document="privacy" contactEmail={undefined} otherLink={other} />)
    expect(screen.queryByRole('link', { name: /@/ })).toBeNull()
    expect(screen.getAllByText(/el canal de contacto que publicaremos aquí/).length).toBe(2)
  })
})
