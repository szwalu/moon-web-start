// 文件路径: src/utils/settings/show_weather.ts

// import { t } from '@/i18n' // <--- 我已将这一行错误的导入删除

import { SettingItem } from '@/types'
import type { SettingItemChildren } from '@/types'

const showWeatherOptions: SettingItemChildren<'show' | 'hide'> = [
  {
    key: 'show',
    name: () => t('显示'),
    value: true,
  },
  {
    key: 'hide',
    name: () => t('隐藏'),
    value: false,
  },
]

export const showWeather = new SettingItem({
  key: 'showWeather',
  name: () => t('显示天气'),
  children: showWeatherOptions,
  defaultKey: 'show',
})
