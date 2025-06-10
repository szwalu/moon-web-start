// 文件路径: src/utils/settings/search.ts (最终正确版本)

import { t } from '@/composables/i18n'

// <-- 1. 从正确的位置导入 t 函数
import type { Search, SettingItemChildren } from '@/types'
import { SettingItem } from '@/types'

const searchList: SettingItemChildren<Search> = [
  {
    name: () => t('settings.searchEngine.bing'), // <-- 2. 恢复为 t() 函数调用
    key: 'Bing',
    value: { url: 'https://www.bing.com/search', wd: 'q', favicon: '/svg/bing.svg', s: 'bi' },
  },
  {
    name: () => t('settings.searchEngine.baidu'),
    key: 'Baidu',
    value: { url: 'https://www.baidu.com/s', wd: 'wd', favicon: '/svg/baidu.svg', s: 'bd' },
  },
  {
    name: () => t('settings.searchEngine.google'),
    key: 'Google',
    value: { url: 'https://www.google.com/search', wd: 'q', favicon: '/svg/google.svg', s: 'gg' },
  },
  {
    name: () => t('settings.searchEngine.sogou'),
    key: 'Sogou',
    value: { url: 'https://www.sogou.com/web', wd: 'query', favicon: '/svg/sogou.svg', s: 'sg' },
  },
  {
    name: () => t('settings.searchEngine.wikipedia'),
    key: 'Wikipedia',
    value: { url: 'https://zh.wikipedia.org/w/index.php', wd: 'search', favicon: '/svg/wikipedia.svg', s: 'wk' },
  },
  {
    name: () => t('settings.searchEngine.local'), // <-- 为“本站搜索”使用新的翻译键
    key: 'Local',
    value: {
      url: '',
      wd: '',
      favicon: '/svg/woabc.jpg',
      s: 'local',
    },
  },
]

export const search = new SettingItem({
  name: () => t('settings.searchEngine.title'), // <-- 恢复为 t() 函数调用
  key: 'search',
  children: searchList,
  defaultKey: 'Bing',
})
