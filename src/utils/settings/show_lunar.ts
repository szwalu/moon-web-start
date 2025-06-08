// 文件路径: src/utils/settings/show_lunar.ts

import { SettingItem, type SettingItemChildren } from '@/types'

const showLunarOptions: SettingItemChildren<boolean> = [
  { name: () => '显示', key: 'Show', value: true },
  { name: () => '隐藏', key: 'Hide', value: false },
]

export const showLunar = new SettingItem({
  name: () => '显示农历',
  key: 'ShowLunar',
  children: showLunarOptions,
  defaultKey: 'Hide',
})
