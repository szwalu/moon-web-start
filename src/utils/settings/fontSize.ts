import { t } from '@/composables/i18n'
import { SettingItem, type SettingItemChildren } from '@/types'

/**
 * 字号选项（特大 / 大 / 中 / 小）
 * key 用字符串，value 也用字符串，保持与其他 SettingItem 一致
 */
const fontSizeOptions: SettingItemChildren<string> = [
  { name: () => t('settings.font_size_extra_large'), key: 'xl', value: 'xl' },
  { name: () => t('settings.font_size_large'), key: 'lg', value: 'lg' },
  { name: () => t('settings.font_size_medium'), key: 'md', value: 'md' },
  { name: () => t('settings.font_size_small'), key: 'sm', value: 'sm' },
]

/**
 * 字号设置（默认值：中 md）
 */
export const fontSize = new SettingItem({
  name: () => t('settings.font_title'),
  key: 'fontSize',
  children: fontSizeOptions,
  defaultKey: 'md',
})
