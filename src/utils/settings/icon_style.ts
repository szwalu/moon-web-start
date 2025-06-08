// 文件路径: src/utils/settings/icon_style.ts

import type { IconStyle, SettingItemChildren } from '@/types'
import { SettingItem } from '@/types'

const iconStyleList: SettingItemChildren<IconStyle> = [
  {
    name: () => '鲜艳',
    key: 'Vivid',
    value: {},
  },
  {
    name: () => '朴素',
    key: 'Plain',
    value: { opacity: '0.8', filter: 'saturate(64%)' },
  },
  {
    name: () => '灰白',
    key: 'Gray',
    value: { opacity: '0.7', filter: 'grayscale(72%)' },
  },
]

export const iconStyle = new SettingItem({
  name: () => '图标风格',
  key: 'IconStyle',
  children: iconStyleList,
  defaultKey: 'Plain',
})
