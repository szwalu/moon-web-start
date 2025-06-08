// 文件路径: src/utils/settings/show_weather.ts

import { SettingItem } from '@/types'
import type { SettingItemChildren } from '@/types'

const showWeatherOptions: SettingItemChildren<true | false> = [
  {
    key: 'show',
    // 写成函数形式，但返回的是直接的字符串，以避免 t() 函数报错
    name: () => '显示',
    value: true,
  },
  {
    key: 'hide',
    name: () => '隐藏',
    value: false,
  },
]

export const showWeather = new SettingItem({
  key: 'showWeather',
  name: () => '显示天气',
  children: showWeatherOptions,
  defaultKey: 'show',
})
