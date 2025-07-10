<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { vOnClickOutside } from '@vueuse/components'
import type { Search } from '@/types'
import { debounce, getFaviconUrl, getText, search as searchSetting } from '@/utils'
import searchEngine from '@/utils/search-engine'
import { useSiteStore } from '@/stores/site'

const settingStore = useSettingStore()
const siteStore = useSiteStore()

const searchList = searchSetting.children
const keyword = ref('')
const curSearchIndex = ref(0)
const searchInputRef = ref<HTMLInputElement>()

watch(() => settingStore.settings.search, (val) => {
  const index = searchList.findIndex(search => search.key === val)
  if (index !== -1)
    curSearchIndex.value = index
}, { immediate: true })

function performLocalSearch(query: string) {
  if (!query || !query.trim())
    return

  const lowerCaseQuery = query.toLowerCase()

  for (const [cateIndex, category] of siteStore.data.entries()) {
    if (category.groupList) {
      for (const group of category.groupList) {
        if (group.siteList) {
          const keywords = lowerCaseQuery.split(/\s+/).filter(k => k)

          const foundSite = group.siteList.find((site) => {
            const name = site.name.toLowerCase()
            const desc = site.desc?.toLowerCase() || ''
            const url = site.url?.toLowerCase() || ''
            const combined = `${name} ${desc} ${url}`

            return keywords.some(k => combined.includes(k))
          })

          if (foundSite) {
            siteStore.setCateIndex(cateIndex)

            setTimeout(() => {
              const element = document.getElementById(String(group.id))
              if (element) {
                const headerElement = document.querySelector('[sticky]')
                const headerHeight = headerElement ? headerElement.clientHeight : 80
                const elementPosition = element.getBoundingClientRect().top
                const offsetPosition = elementPosition + window.pageYOffset - headerHeight - 10

                window.scrollTo({
                  top: offsetPosition,
                  behavior: 'smooth',
                })

                clearNoticeKey()
                searchInputRef.value?.blur()
              }
            }, 150)
            return
          }
        }
      }
    }
  }

  // @ts-expect-error $message 是全局挂载的
  $message.info(t('messages.noResultsPre') + query + t('messages.noResultsPost'))
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
    performLocalSearch(keyword.value)
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
}, 100)

function handleInput() {
  if (!keyword.value.trim()) {
    clearNoticeKey()
    return
  }
  if (searchList[curSearchIndex.value].key === 'Local') {
    clearNoticeKey()
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

function keyNext(e: Event) {
  e.preventDefault()
  if (noticeKeyList.value.length === 0)
    return
  selectedIndex.value = (selectedIndex.value + 1) % noticeKeyList.value.length
}

function keyPrev(e: Event) {
  e.preventDefault()
  if (noticeKeyList.value.length === 0)
    return
  selectedIndex.value = (selectedIndex.value - 1 + noticeKeyList.value.length) % noticeKeyList.value.length
}

// --- v-v-v 这里是本次修改的地方 v-v-v ---

function handleCloseClick() {
  keyword.value = ''
  searchInputRef.value?.focus()
}
function handleKeyRecomend(e: Event) {
  if (e.target !== searchInputRef.value)
    clearNoticeKey()
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
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleFocusShortcut)
})
</script>

<template>
  <div class="search-bar-container relative mx-auto w-full flex h-44 sm:w-[700px]!">
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
      v-show="showKeyDownSel && noticeKeyList.length > 0"
      v-on-click-outside="handleKeyRecomend"
      class="absolute z-9 w-full h-10em t-100p"
      @mouseleave="handleLeave"
    >
      <div bg="$main-bg-c" class="search-dropdown z-9 py-6 border-2 l-0 t-0 t-100p">
        <div
          v-for="(item, i) in noticeKeyList" :key="i" class="cursor-pointer text-15 p-5"
          :class="{ 'bg-$site-hover-c': i === selectedIndex }"
          @mouseover="handleHover(i)"
          @click="jumpSearch(i)"
        >
          <div class="flex-left gap-x-8" style="margin: 0.75rem; margin-left: 2rem;">
            <div>{{ item }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-bar-container {
  background-color: white;
  border: 1px solid #e5e7eb;
  transition: background-color 0.3s ease, border-color 0.3s ease;
}

.dark .search-bar-container {
  background-color: #262626;
  border-color: #404040;
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
</style>
