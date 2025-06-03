// src/utils/faviconCache.ts
import { reactive, watch } from 'vue'

const FAVICON_CACHE_KEY = 'faviconDataCache' // localStorage 的键名

// 尝试从 localStorage 加载初始缓存
function loadCacheFromLocalStorage(): Map<string | number, string> {
  const cachedData = localStorage.getItem(FAVICON_CACHE_KEY)
  if (cachedData) {
    try {
      // localStorage 存储的是 JSON 字符串，需要解析
      // Map 对象不能直接 JSON.stringify/parse，需要转换
      const parsedArray = JSON.parse(cachedData) as Array<[string | number, string]>
      return new Map(parsedArray)
    }
    catch (e) {
      console.error('Failed to parse favicon cache from localStorage', e)
      localStorage.removeItem(FAVICON_CACHE_KEY) // 解析失败则移除损坏的数据
      return new Map()
    }
  }
  return new Map()
}

export const faviconCache = reactive<Map<string | number, string>>(loadCacheFromLocalStorage())

// 监听 faviconCache 的变化，并将其存入 localStorage
watch(faviconCache, (newCache) => {
  try {
    // Map 对象需要转换为数组才能 JSON.stringify
    const arrayToStore = Array.from(newCache.entries())
    localStorage.setItem(FAVICON_CACHE_KEY, JSON.stringify(arrayToStore))
  }
  catch (e) {
    console.error('Failed to save favicon cache to localStorage', e)
  }
}, { deep: true }) // deep: true 对于 Map 的变化监听很重要
