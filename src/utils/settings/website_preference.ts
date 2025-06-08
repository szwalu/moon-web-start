// 文件路径: src/utils/settings/website_preference.ts

import type { SettingItemChildren, WebsitePreference } from '@/types'
import { SettingItem } from '@/types'

const websitePreferenceList: SettingItemChildren<WebsitePreference> = [
  // --- 修改: 将所有 t() 调用改为返回直接的字符串 ---
  { name: () => '自动', key: 'Auto', value: 'Auto' },
  { name: () => '中国大陆', key: 'ChineseMainland', value: 'ChineseMainland' },
  { name: () => '全球', key: 'Global', value: 'Global' },
  { name: () => '自定义', key: 'Customize', value: 'Customize' },
]

export const websitePreference = new SettingItem({
  name: () => '网站偏好', // <-- 修改
  key: 'WebsitePreference',
  children: websitePreferenceList,
  defaultKey: 'Auto',
})
