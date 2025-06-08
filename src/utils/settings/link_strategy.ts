// 文件路径: src/utils/settings/link_strategy.ts

import type { SettingItemChildren } from '@/types'
import { SettingItem } from '@/types'

const linkStrategyList: SettingItemChildren<string> = [
  { name: () => '当前标签页打开', key: 'currentTab', value: '_self' },
  { name: () => '新标签页打开', key: 'newTab', value: '_blank' },
]

export const linkStrategy = new SettingItem({
  name: () => '链接策略',
  key: 'LinkStrategy',
  children: linkStrategyList,
  defaultKey: 'newTab',
})
