// The translator inside React: one provider at the top of the app, `useI18n()` in any screen.
import {
  createContext,
  Fragment,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react'
import {
  DEFAULT_LOCALE,
  type Locale,
  messagesFor,
  messagesVersion,
  onMessagesLoaded,
  setActiveLocale,
} from './locales'
import {
  type CountParams,
  createTranslator,
  type MessageKey,
  type Params,
  type PluralKey,
  type TextKey,
  type Translator,
} from './translate'

/** A value for `{name}`, or a wrapper for `<name>…</name>`: a link, a bold word. */
export type RichValue = ReactNode | ((chunks: ReactNode) => ReactNode)
export type RichParams = Readonly<Record<string, RichValue>>

export type I18n = Translator & {
  /** Copy with markup in it: «Revisa el código. <home>Ver otros avisos</home>» */
  rich: {
    (key: TextKey, params: RichParams): ReactNode
    (key: PluralKey, params: RichParams & CountParams): ReactNode
  }
}

const TOKEN = /<(\w+)>([\s\S]*?)<\/\1>|\{(\w+)\}/g

function richText(template: string, values: RichParams, locale: Locale): ReactNode[] {
  const parts: ReactNode[] = []
  let last = 0
  for (const match of template.matchAll(TOKEN)) {
    const [whole, tag, inner, name] = match
    if (match.index > last) parts.push(template.slice(last, match.index))
    if (tag !== undefined) {
      const wrap = values[tag]
      const children = richText(inner ?? '', values, locale)
      parts.push(typeof wrap === 'function' ? wrap(children) : children)
    } else if (name !== undefined && name in values) {
      const value = values[name]
      parts.push(typeof value === 'number' ? value.toLocaleString(locale) : (value as ReactNode))
    } else {
      parts.push(whole)
    }
    last = match.index + whole.length
  }
  if (last < template.length) parts.push(template.slice(last))
  // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one template never reorder
  return parts.map((part, index) => <Fragment key={index}>{part}</Fragment>)
}

function withRich(translator: Translator): I18n {
  const rich = ((key: MessageKey, params: RichParams) => {
    const count = typeof params.count === 'number' ? params.count : undefined
    return richText(
      translator.template(key, count),
      { ...translator.globals, ...params },
      translator.locale,
    )
  }) as I18n['rich']
  return Object.assign(translator, { rich })
}

export function createI18n(locale: Locale, globals: Params = {}): I18n {
  return withRich(
    createTranslator(locale, messagesFor(locale), messagesFor(DEFAULT_LOCALE), globals),
  )
}

// Outside a provider (a component test) the app speaks the source language.
const Context = createContext<I18n>(createI18n(DEFAULT_LOCALE))

export function I18nProvider({
  locale,
  globals,
  children,
}: {
  locale: Locale
  globals?: Params
  children: ReactNode
}) {
  // Re-render whenever a part of a language file arrives; until then the source language fills in.
  const version = useSyncExternalStore(onMessagesLoaded, messagesVersion)
  setActiveLocale(locale)
  // biome-ignore lint/correctness/useExhaustiveDependencies: version says the message objects were filled in place
  const value = useMemo(
    () =>
      withRich(createTranslator(locale, messagesFor(locale), messagesFor(DEFAULT_LOCALE), globals)),
    [locale, version, globals],
  )
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export const useI18n = (): I18n => useContext(Context)
