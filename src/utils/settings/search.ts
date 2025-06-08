// 文件路径: src/utils/settings/search.ts

import type { Search, SettingItemChildren } from '@/types'
import { SettingItem } from '@/types'

const searchList: SettingItemChildren<Search> = [
  {
    name: () => '必应', // 修改: 改为函数形式
    key: 'Bing',
    value: { url: 'https://www.bing.com/search', wd: 'q', favicon: '/svg/bing.svg', s: 'bi' },
  },
  {
    name: () => '百度', // 修改: 改为函数形式
    key: 'Baidu',
    value: { url: 'https://www.baidu.com/s', wd: 'wd', favicon: '/svg/baidu.svg', s: 'bd' },
  },
  {
    name: () => '谷歌', // 修改: 改为函数形式
    key: 'Google',
    value: { url: 'https://www.google.com/search', wd: 'q', favicon: '/svg/google.svg', s: 'gg' },
  },
  {
    name: () => '搜狗', // 修改: 改为函数形式
    key: 'Sogou',
    value: { url: 'https://www.sogou.com/web', wd: 'query', favicon: '/svg/sogou.svg', s: 'sg' },
  },
  {
    name: () => '维基百科', // 修改: 改为函数形式
    key: 'Wikipedia',
    value: { url: 'https://zh.wikipedia.org/w/index.php', wd: 'search', favicon: '/svg/wikipedia.svg', s: 'wk' },
  },
  {
    name: () => '本站搜索', // 修改: 改为函数形式
    key: 'Local',
    value: {
      url: '',
      wd: '',
      favicon: '/svg/woabc.jpg', // 您自定义的图标
      s: 'local',
    },
  },
]

export const search = new SettingItem({
  name: () => '搜索引擎', // 修改: 改为函数形式
  key: 'Search',
  children: searchList,
  defaultKey: 'Bing',
})
