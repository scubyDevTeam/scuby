// Modules the `locale-namespaces` plugin (vite.config.ts) makes out of src/i18n/locales/<lang>.json.
type MessagesPart = Record<string, unknown>

declare module 'virtual:messages/core/es' {
  const part: MessagesPart
  export default part
}

declare module 'virtual:messages/loaders' {
  /** `loaders[lang][part]()` → that part of the language file: `core` or a deferred namespace. */
  export const loaders: Record<string, Record<string, () => Promise<{ default: MessagesPart }>>>
}
