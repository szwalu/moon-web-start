import type { App } from 'vue'
import type { Locale } from 'vue-i18n'
import { createI18n } from 'vue-i18n'

export const i18n = createI18n({
  legacy: false,
  locale: '',
  messages: {},
  // 可选：增加 fallback，避免缺键时报错
  fallbackLocale: 'en',
})

const localesMap = Object.fromEntries(
  Object.entries(import.meta.glob('../locales/*.yml'))
    .map(([path, loadLocale]) => [path.match(/([\w-]*)\.yml$/)?.[1], loadLocale]),
) as Record<Locale, () => Promise<{ default: Record<string, string> }>>

export const availableLocales = Object.keys(localesMap)

const loadedLanguages: string[] = []

function setI18nLanguage(lang: Locale) {
  i18n.global.locale.value = lang as any
  if (typeof document !== 'undefined')
    document.querySelector('html')?.setAttribute('lang', lang)
  return lang
}

// ========= 新增：语言码规范化 & 最佳匹配 =========
const FALLBACK_LOCALE = (localesMap.en ? 'en' : (availableLocales[0] || 'en')) as Locale

function bestLocale(raw?: string | null): Locale {
  if (!raw)
    return FALLBACK_LOCALE
  // 1) 先看是否存在完全同名（极少数你真的有 en-US.yml 时也能命中）
  if (localesMap[raw as Locale])
    return raw as Locale

  const l = raw.toLowerCase()
  // 2) 中文族群统一用 zh-CN（你项目只有 zh-CN.yml）
  if (l.startsWith('zh'))
    return (localesMap['zh-CN'] ? 'zh-CN' : FALLBACK_LOCALE) as Locale

  // 3) 再尝试主语言（en-GB -> en）
  const primary = l.split('-')[0] as Locale
  if (localesMap[primary])
    return primary

  // 4) 兜底
  return FALLBACK_LOCALE
}
// ========= 新增结束 =========

let isFirst = true

export async function loadLanguageAsync(lang: string): Promise<Locale> {
  // SYSTEM 也先规范化
  const want = (lang.toUpperCase() === 'SYSTEM')
    ? bestLocale(typeof navigator !== 'undefined' ? navigator.language : null)
    : bestLocale(lang)

  // 如果与当前相同
  if (i18n.global.locale.value === want)
    return setI18nLanguage(want)

  // 如果已经加载过
  if (loadedLanguages.includes(want))
    return setI18nLanguage(want)

  if (!isFirst)
    $message.loading(t('messages.loading'), { duration: 0 })

  try {
    const loader = localesMap[want] || localesMap[FALLBACK_LOCALE]
    const messages = await loader()
    if (!isFirst)
      $message.destroyAll()
    i18n.global.setLocaleMessage(want, messages.default)
    loadedLanguages.push(want)
    return setI18nLanguage(want)
  }
  catch (err) {
    if (!isFirst)
      $message.destroyAll()
    // 最终兜底：至少装上 fallback
    const fallbackLoader = localesMap[FALLBACK_LOCALE]
    const messages = await fallbackLoader()
    i18n.global.setLocaleMessage(FALLBACK_LOCALE, messages.default)
    loadedLanguages.push(FALLBACK_LOCALE)
    return setI18nLanguage(FALLBACK_LOCALE)
  }
}

export async function setupI18n(app: App) {
  app.use(i18n)

  // 保留原始值（可能是 'SYSTEM'），规范化交给 loadLanguageAsync 处理
  let raw = (typeof navigator !== 'undefined' ? navigator.language : '') || ''
  const settings = loadSettings()
  if (settings?.language)
    raw = settings.language

  await loadLanguageAsync(raw)
  isFirst = false

  // （可选增强）如果用户选了“跟随系统”，系统语言改变时自动切换
  if (settings?.language?.toUpperCase() === 'SYSTEM' && typeof window !== 'undefined') {
    window.addEventListener('languagechange', () => {
      // 让它再次按系统语言规范化并切换
      loadLanguageAsync('SYSTEM')
    })
  }
}
