// 文件路径: src/utils/settings/tag_mode.ts

import type { SettingItemChildren, TagMode } from '@/types'
import { SettingItem } from '@/types'

const tagModeList: SettingItemChildren<TagMode> = [
  { name: () => '精简', key: 'Concise', value: 'Concise' },
  { name: () => '完全', key: 'Full', value: 'Full' },
]

export const tagMode = new SettingItem({
  name: () => '标签模式',
  key: 'TagType',
  children: tagModeList,
  defaultKey: 'Full',
})
