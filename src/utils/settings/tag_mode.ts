import type { SettingItemChildren, TagMode } from '@/types'
import { SettingItem } from '@/types'

const tagModeList: SettingItemChildren<TagMode> = [
  { name: () => t('settings.tagMode.concise'), key: 'Concise', value: 'Concise' },
  { name: () => t('settings.tagMode.full'), key: 'Full', value: 'Full' },
]

export const tagMode = new SettingItem({
  name: () => t('settings.tagMode.title'),
  key: 'TagType',
  children: tagModeList,
  // v-- 修改的就是下面这一行 --v
  defaultKey: (typeof navigator !== 'undefined' && /Mobi|Android|iPhone/i.test(navigator.userAgent)) ? 'Concise' : 'Full',
})
