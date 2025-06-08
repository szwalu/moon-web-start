// 文件路径: src/utils/settings/show_second.ts

import { SettingItem, type SettingItemChildren } from '@/types'

const showSecondOptions: SettingItemChildren<boolean> = [
  { name: () => '显示', key: 'Show', value: true },
  { name: () => '隐藏', key: 'Hide', value: false },
]

export const showSecond = new SettingItem({
  name: () => '显示秒钟',
  key: 'ShowSecond',
  children: showSecondOptions,
  defaultKey: 'Hide',
})
