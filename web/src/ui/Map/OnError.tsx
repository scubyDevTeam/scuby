import { Component, type ReactNode } from 'react'

/** The map chunk failing to load (offline) must not take the page down with it. */
export class OnError extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
