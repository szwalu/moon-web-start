```vue
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { vOnClickOutside } from '@vueuse/components'
import type { Search } from '@/types'
import { debounce, getFaviconUrl, getText, search as searchSetting } from '@/utils'
import searchEngine from '@/utils/search-engine'
import { useSiteStore } from '@/stores/site'
import { useSettingStore } from '@/stores/setting'

const settingStore = useSettingStore()
const siteStore = useSiteStore()
const searchList = searchSetting.children
const keyword = ref('')
const curSearchIndex = ref(0)
const searchInputRef = ref<HTMLInputElement>()
const searchBarRef = ref<HTMLDivElement>()
const isSticky = ref(false)
const headerHeight = ref(0)
const initialOffsetTop = ref(0)
const parentLeft = ref(0)
const parentWidth = ref(0)

watch(() => settingStore.settings.search, (val) => {
  const index = searchList.findIndex(search => search.key === val)
  if (index !== -1)
    curSearchIndex.value = index
}, { immediate: true })

// 动态计算固定定位时的样式，基于父容器居中
const fixedStyle = computed(() => {
  if (!isSticky.value)
    return {}
  const left = parentLeft.value + (parentWidth.value / 2)
  return {
    left: `${left}px`,
    transform: 'translateX(-50%)',
    top: `${headerHeight.value}px`,
    width: `${Math.min(parentWidth.value, 700)}px`,
  }
})

// 防抖处理滚动事件
const handleScroll = debounce(() => {
  if (searchBarRef.value) {
    const headerElement = document.querySelector('[sticky]') || document.querySelector('.header-left')?.parentElement
    const parentElement = searchBarRef.value.parentElement || document.body
    if (headerElement) {
      headerHeight.value = headerElement.getBoundingClientRect().height
      const searchBarRect = searchBarRef.value.getBoundingClientRect()
      const currentOffsetTop = window.pageYOffset + searchBarRect.top
      isSticky.value = searchBarRect.top <= headerHeight.value + 10 && currentOffsetTop > initialOffsetTop.value
      const parentRect = parentElement.getBoundingClientRect()
      parentLeft.value = parentRect.left
      parentWidth.value = parentRect.width
    }
    else {
      headerHeight.value = 80
      isSticky.value = searchBarRef.value.getBoundingClientRect().top <= 40
      parentLeft.value = 0
      parentWidth.value = window.innerWidth
    }
  }
}, 10)

// 本地搜索结果状态
interface LocalSearchResult {
  name: string
  desc?: string
  url: string
}
const localSearchResults = ref<LocalSearchResult[]>([])
const showLocalResults = ref(false)

// 防抖本地搜索
const debouncedLocalSearch = debounce((query: string) => {
  performLocalSearch(query)
}, 100)

function performLocalSearch(query: string) {
  if (!query.trim()) {
    clearLocalResults()
    return
  }
  const results: LocalSearchResult[] = []
  for (const category of siteStore.data) {
    if (category.groupList) {
      for (const group of category.groupList) {
        if (group.siteList) {
          for (const site of group.siteList) {
            const name = site.name || ''
            const desc = site.desc || ''
            const url = site.url || ''
            if (name.includes(query) || desc.includes(query) || url.includes(query)) {
              if (site.name) {
                results.push({
                  name: site.name,
                  desc: site.desc,
                  url: site.url || '#',
                })
              }
            }
          }
        }
      }
    }
  }
  results.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  localSearchResults.value = results
  showLocalResults.value = results.length > 0
  if (results.length === 0)
    $message.info(`${t('messages.noResultsPre') + query} ${t('messages.noResultsPost')}`)
}

function visitSite(index: number) {
  const site = localSearchResults.value[index]
  if (site?.url && site.url !== '#') {
    window.open(site.url, '_blank')
    clearLocalResults()
    searchInputRef.value?.blur()
  }
}

function performWebSearch() {
  if (!keyword.value.trim())
    return

  const currentSearch = searchList[curSearchIndex.value].value
  const finalUrl = `${currentSearch.url}?${currentSearch.wd}=${encodeURIComponent(keyword.value)}`
  window.open(finalUrl, '_blank')
  clearNoticeKey()
  searchInputRef.value?.blur()
}

function handleSearch() {
  const currentEngine = searchList[curSearchIndex.value]
  if (currentEngine.key === 'Local')
    debouncedLocalSearch(keyword.value)
  else
    performWebSearch()
}

function _getFavicon(search: Search) {
  if (search.favicon?.startsWith('i-'))
    return null
  return search.favicon || getFaviconUrl(search.url)
}

/* Search engine selection */
const selectionVisible = ref(false)
function toggleSelection() {
  selectionVisible.value = !selectionVisible.value
}

function changeSearch(i: number) {
  curSearchIndex.value = i
  settingStore.setSettings({ search: searchList[i].key })
  toggleSelection()
}

/* Keyword recommend */
const showKeyDownSel = ref(false)
const noticeKeyList = ref<string[]>([])
const selectedIndex = ref(-1)
const requestEngApi = debounce(() => {
  const curSearch = searchList[curSearchIndex.value]
  if (searchEngine.complete && typeof searchEngine.complete === 'function') {
    searchEngine.complete(curSearch.key as any, keyword.value, (params: { list: string[] }) => {
      showKeyDownSel.value = true
      noticeKeyList.value = params.list
    })
  }
}, 10)

function handleInput() {
  if (!keyword.value.trim()) {
    clearNoticeKey()
    clearLocalResults()
    return
  }
  if (searchList[curSearchIndex.value].key === 'Local') {
    clearNoticeKey()
    debouncedLocalSearch(keyword.value)
    return
  }
  selectedIndex.value = -1
  requestEngApi()
}

function jumpSearch(i: number) {
  keyword.value = noticeKeyList.value[i]
  handleSearch()
}

function clearNoticeKey() {
  showKeyDownSel.value = false
  noticeKeyList.value = []
  selectedIndex.value = -1
}

function clearLocalResults() {
  showLocalResults.value = false
  localSearchResults.value = []
  selectedIndex.value = -1
}

function keyNext(e: Event) {
  e.preventDefault()
  if (searchList[curSearchIndex.value].key === 'Local' && localSearchResults.value.length > 0)
    selectedIndex.value = (selectedIndex.value + 1) % localSearchResults.value.length
  else if (noticeKeyList.value.length > 0)
    selectedIndex.value = (selectedIndex.value + 1) % noticeKeyList.value.length
}

function keyPrev(e: Event) {
  e.preventDefault()
  if (searchList[curSearchIndex.value].key === 'Local' && localSearchResults.value.length > 0)
    selectedIndex.value = (selectedIndex.value - 1 + localSearchResults.value.length) % localSearchResults.value.length
  else if (noticeKeyList.value.length > 0)
    selectedIndex.value = (selectedIndex.value - 1 + noticeKeyList.value.length) % noticeKeyList.value.length
}

function handleCloseClick() {
  keyword.value = ''
  clearLocalResults()
  clearNoticeKey()
  searchInputRef.value?.focus()
}

function handleKeyRecomend(e: any) {
  if (e.target !== searchInputRef.value) {
    clearLocalResults()
    clearNoticeKey()
  }
}

function handleHover(i: number) {
  selectedIndex.value = i
}

function handleLeave() {
  selectedIndex.value = -1
}

function handleFocus() {
  if (keyword.value.trim())
    handleInput()
}

function handleFocusShortcut(e: KeyboardEvent) {
  if (e.ctrlKey && e.key === 'Enter')
    searchInputRef.value?.focus()
}

const { iconStyle } = useIconStyle()

onMounted(() => {
  window.addEventListener('keydown', handleFocusShortcut)
  window.addEventListener('scroll', handleScroll)
  if (searchBarRef.value)
    initialOffsetTop.value = searchBarRef.value.offsetTop

  handleScroll()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleFocusShortcut)
  window.removeEventListener('scroll', handleScroll)
})
</script>

<template>
  <div ref="searchBarRef" class="search-bar-container relative mx-auto w-full flex h-44 sm:w-[700px]" :class="{ fixed: isSticky }" :style="fixedStyle">
    <div v-on-click-outside="() => selectionVisible = false" class="search-engine-logo-container relative flex-center shrink-0 w-44">
      <div hover="op-100" class="h-full w-full flex-center cursor-pointer op-80 transition-300" @click="toggleSelection">
        <div v-if="searchList[curSearchIndex].value.favicon?.startsWith('i-')" :class="searchList[curSearchIndex].value.favicon" class="text-24" />
        <img v-else :src="_getFavicon(searchList[curSearchIndex].value)" :style="iconStyle" class="h-32 w-32">
      </div>
      <div v-show="selectionVisible" bg="$main-bg-c" class="search-dropdown absolute z-9 border-2 l-0 t-0 t-100p w-200">
        <div
          v-for="(item, i) in searchList"
          :key="i"
          hover="bg-$site-hover-c"
          class="flex cursor-pointer items-center justify-between px-12 py-7"
          @click="changeSearch(i)"
        >
          <div class="$text-c-1 flex-center gap-x-8 text-15">
            <div v-if="item.value.favicon?.startsWith('i-')" :class="item.value.favicon" class="text-20" />
            <img v-else :src="_getFavicon(item.value)" :style="iconStyle" class="circle h-20 w-20">
            <div>{{ getText(item.name) }}</div>
          </div>
          <div v-if="curSearchIndex === i" class="i-carbon:checkmark text-18" />
        </div>
      </div>
    </div>
    <div class="w-full flex items-center">
      <input
        ref="searchInputRef"
        v-model="keyword"
        autofocus
        class="$text-c-1 search-input h-full w-full bg-inherit px-2 op-80"
        :placeholder="getText(searchList[curSearchIndex].name)"
        @keydown.enter="handleSearch"
        @input="handleInput"
        @focus="handleFocus"
        @keydown.down.exact="keyNext"
        @keydown.up.exact="keyPrev"
      >
      <div
        v-if="keyword.length > 0"
        hover="op-80"
        class="i-carbon:close mr-8 cursor-pointer text-20 op-40 transition duration-300"
        @click="handleCloseClick"
      />
    </div>
    <button class="search-button flex-center shrink-0 gap-x-4 px-16 btn" @click="handleSearch">
      <span class="i-carbon:search inline-block text-16" />
    </button>
    <div
      v-show="(showKeyDownSel && noticeKeyList.length > 0) || (showLocalResults && localSearchResults.length > 0)"
      v-on-click-outside="handleKeyRecomend"
      class="absolute z-9 h-auto max-h-[600px] w-full t-100p overflow-y-auto"
      @mouseleave="handleLeave"
    >
      <div bg="$main-bg-c" class="search-dropdown z-9 py-6 border-2 l-0 t-0 t-100p">
        <!-- 网页搜索的关键词推荐 -->
        <template v-if="showKeyDownSel && noticeKeyList.length > 0">
          <div
            v-for="(item, i) in noticeKeyList"
            :key="i"
            class="cursor-pointer text-15 p-5"
            :class="{ 'bg-$site-hover-c': i === selectedIndex }"
            @mouseover="handleHover(i)"
            @click="jumpSearch(i)"
          >
            <div class="flex-left gap-x-8" style="margin: 0.75rem; margin-left: 2rem;">
              <div>{{ item }}</div>
            </div>
          </div>
        </template>
        <!-- 本地搜索结果 -->
        <template v-if="showLocalResults && localSearchResults.length > 0">
          <div
            v-for="(site, i) in localSearchResults"
            :key="`${site.url}-${site.name}-${i}`"
            class="search-result-card cursor-pointer p-5"
            :class="{ 'bg-$site-hover-c': i === selectedIndex }"
            @mouseover="handleHover(i)"
            @click="visitSite(i)"
          >
            <div class="flex-left flex-col gap-y-2" style="margin: 0.75rem; margin-left: 2rem;">
              <div class="text-15 font-medium">{{ site.name }}</div>
              <div v-if="site.desc" class="line-clamp-2 text-13 text-gray-500 dark:text-gray-400">{{ site.desc }}</div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-bar-container {
  background-color: white;
  border: 1px solid #e5e7eb;
  transition: background-color 0.3s ease, border-color 0.3s ease, top 0.3s ease, left 0.3s ease, width 0.3s ease;
}

.search-bar-container.fixed {
  position: fixed;
  z-index: 1000;
  background-color: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.dark .search-bar-container {
  background-color: #262626;
  border-color: #404040;
}

.dark .search-bar-container.fixed {
  background-color: #262626;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.search-input {
  background-color: transparent;
  outline: none;
  font-size: 16px;
}

.search-input::placeholder {
  color: #9ca3af;
}

.dark .search-input::placeholder {
  color: #71717a;
}

.search-result-card {
  border-bottom: 1px solid #e5e7eb;
  transition: background-color 0.2s ease;
}

.dark .search-result-card {
  border-bottom: 1px solid #404040;
}

.search-result-card:last-child {
  border-bottom: none;
}

.search-result-card:hover {
  background-color: var(--site-hover-c);
}
</style>
```
