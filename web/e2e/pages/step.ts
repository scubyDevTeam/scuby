import { test } from '@playwright/test'

/**
 * One user-level action as a step of the report: «Sign in with an emailed code», not twelve
 * locator calls. Boxed, so a failure inside points at the spec line that asked for the action.
 */
export function step<T>(title: string, body: () => Promise<T>): Promise<T> {
  return test.step(title, body, { box: true })
}
