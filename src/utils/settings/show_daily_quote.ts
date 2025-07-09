import { t } from '@/composables/i18n'
import { SettingItem, type SettingItemChildren } from '@/types'

// 步骤 1: 将选项变量名从 "天气" 改为 "每日一句"
const showDailyQuoteOptions: SettingItemChildren<boolean> = [
  { name: () => t('settings.common.show'), key: 'Show', value: true },
  { name: () => t('settings.common.hide'), key: 'Hide', value: false },
]

// 步骤 2: 修改导出的设置项实例
export const showDailyQuote = new SettingItem({
  // 'name' 指向新的翻译文本
  name: () => t('settings.showDailyQuote.title'),

  // 'key' 是最重要的，必须和你在其他地方使用的 key 一致
  key: 'showDailyQuote',

  // 'children' 使用我们上面新命名的选项变量
  children: showDailyQuoteOptions,

  // 'defaultKey' 设置默认是显示还是隐藏，这里我们默认设置为 'Hide'
  defaultKey: 'Hide',
})
