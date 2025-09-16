// src/utils/cacheKeys.ts

/**
 * 统一管理应用中所有的缓存键名
 */
export const CACHE_KEYS = {
  // 主页缓存
  HOME: 'cached_notes_home',
  HOME_META: 'cached_notes_home_meta',

  // 标签缓存
  TAG_PREFIX: 'cached_notes_tag_',

  // 搜索缓存
  SEARCH_PREFIX: 'cached_notes_search_',

  // 日历缓存
  CALENDAR_PREFIX: 'cached_notes_calendar_date_',
  CALENDAR_ALL_DATES: 'cached_notes_calendar_all_dates',
}

/**
 * 获取标签缓存的键名
 * @param tag 标签名, e.g., '#work'
 */
export const getTagCacheKey = (tag: string) => `${CACHE_KEYS.TAG_PREFIX}${tag}`

/**
 * 获取搜索缓存的键名
 * @param query 搜索关键词
 */
export function getSearchCacheKey(query: string): string {
  const normalizedQuery = query.trim().toLowerCase()
  return `${CACHE_KEYS.SEARCH_PREFIX}${encodeURIComponent(normalizedQuery)}`
}

/**
 * 获取日历某一天笔记的缓存键名
 * @param date 日期对象
 */
export function getCalendarDateCacheKey(date: Date) {
  const year = date.getFullYear()
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  return `${CACHE_KEYS.CALENDAR_PREFIX}${year}-${month}-${day}`
}
