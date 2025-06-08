// 文件路径: src/utils/settings/show_date.ts

import { SettingItem, type SettingItemChildren } from '@/types'

const showDateList: SettingItemChildren<boolean> = [
  { name: () => '显示', key: 'Show', value: true },
  { name: () => '隐藏', key: 'Hide', value: false },
]

export const showDate = new SettingItem({
  name: () => '显示日期',
  key: 'ShowDate', // 修正: key 应与文件名和设置项对应
  children: showDateList,
  defaultKey: 'Hide',
})
