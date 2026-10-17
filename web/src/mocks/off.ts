// What `@mocks/browser` resolves to when VITE_API_MOCK is not `true` (vite.config.ts): the emulated
// backend — and the copy of the whole contract it carries — never enters a production build.
export async function startMocks(): Promise<void> {}

export function resetDemo(): void {}
