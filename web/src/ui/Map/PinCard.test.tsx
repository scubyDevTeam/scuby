// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PinCard } from './PinCard'

describe('PinCard', () => {
  it('is a labelled dialog that takes the focus and closes on Escape or its button', () => {
    const onClose = vi.fn()
    render(
      <PinCard label="Luna" onClose={onClose}>
        <p>Contenido</p>
      </PinCard>,
    )
    const card = screen.getByRole('dialog', { name: 'Luna' })
    expect(document.activeElement).toBe(card)

    fireEvent.keyDown(card, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
