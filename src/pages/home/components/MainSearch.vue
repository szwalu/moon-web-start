<script setup lang="ts">
import { vOnClickOutside } from '@vueuse/components'
import type { Search } from '@/types'
import { debounce, getFaviconUrl, getText, search as searchSetting } from '@/utils'
import searchEngine from '@/utils/search-engine'

const settingStore = useSettingStore()

const searchList = searchSetting.children

const keyword = ref('')

const curSearchIndex = ref(0)

const searchInputRef = ref<HTMLInputElement>()

function initcurSearchIndex() {
  curSearchIndex.value = searchList.findIndex(search => search.key === settingStore.settings.search) || 0
}

watch(() => settingStore.settings.search, () => {
  initcurSearchIndex()
}, { immediate: true })

function search(e?: any) {
  if (
    !keyword.value.trim()
    // 防止中文输入时回车键触发搜索
    || e?.isComposing
  )
    return
  const currentSearch = searchList[curSearchIndex.value]
  window.open(`${currentSearch.value.url}?${currentSearch.value.wd}=${encodeURIComponent(keyword.value)}`)
  clearNoticeKey()
  searchInputRef.value?.blur()
}

function _getFavicon(search: Search) {
  return search.favicon || getFaviconUrl(search.url)
}

/* Search engine selection */
const selectionVisible = ref(false)

function changeSearch(i: number) {
  curSearchIndex.value = i
  toggleSelection()
}

function toggleSelection() {
  selectionVisible.value = !selectionVisible.value
}

/* Handle keydown */
function handleKeydown(e: KeyboardEvent) {
  // - 快捷切换搜索引擎
  if (e.key === '#' && !keyword.value.length)
    selectionVisible.value = true
  const target = (keyword.value + e.key).match(/^#[a-z]+/)
  if (target) {
    const s = target[0].replace('#', '')
    const index = searchList.findIndex(item => item.value.s === s)
    if (index === -1)
      return
    e.preventDefault()
    changeSearch(index)
    keyword.value = ''
    selectionVisible.value = false
  }
  // 关闭搜索引擎选择
  if (keyword.value === '#' && e.key === 'Backspace')
    selectionVisible.value = false
}

/* Keyword recommend */
const showKeyDownSel = ref(false)
const noticeKeyList = ref<string[]>([])
const selectedIndex = ref(0)

const requestEngApi = debounce(() => {
  const curSearch = searchList[curSearchIndex.value]
  searchEngine.complete(curSearch.key as any, keyword.value, (params: Params) => {
    showKeyDownSel.value = true
    if (keyword.value.trim().length === 0)
      return

    noticeKeyList.value.splice(0, noticeKeyList.value.length || 0)
    noticeKeyList.value.push(keyword.value, ...params.list)
  })
}, 100)

function handleCloseClick() {
  keyword.value = ''
  searchInputRef.value?.focus()
}

function handleInput(_: Event) {
  if (keyword.value.indexOf('#') === 0)
    return
  if (!keyword.value.trim()) {
    clearNoticeKey()
    return
  }
  selectedIndex.value = 0
  requestEngApi()
}

interface Params {
  eng: string
  list: string[]
  wd: string
}

function jumpSearch(i: number) {
  keyword.value = noticeKeyList.value[i]
  search()
}

function clearNoticeKey() {
  showKeyDownSel.value = false
  noticeKeyList.value.splice(0, noticeKeyList.value.length || 0)
  selectedIndex.value = 0
  noticeKeyList.value.push(keyword.value)
}

function keyNext(e: Event) {
  e.preventDefault()
  selectedIndex.value = (selectedIndex.value + 1) % noticeKeyList.value.length || 0
  keyword.value = noticeKeyList.value[selectedIndex.value]
}

function keyPrev(e: Event) {
  e.preventDefault()
  selectedIndex.value = (selectedIndex.value - 1 + noticeKeyList.value.length) % noticeKeyList.value.length || 0
  keyword.value = noticeKeyList.value[selectedIndex.value]
}

function handleKeyRecomend(e: Event) {
  const clickedInput = e.target === searchInputRef.value
  if (clickedInput)
    return

  clearNoticeKey()
}

function handleHover(i: number) {
  selectedIndex.value = i
}

function handleLeave() {
  selectedIndex.value = 0
}

function handleFocus() {
  handleInput(new Event('input'))
}

function handleFocusShortcut(e: KeyboardEvent) {
  if (!(e.ctrlKey && e.key === 'Enter'))
    return
  searchInputRef.value?.focus()
  handleFocus()
}

function setActive(i: number) {
  selectedIndex.value = i
}

function setInactive(_: number) {
  selectedIndex.value = 0
}

/* Icon style */
const { iconStyle } = useIconStyle()

onMounted(() => {
  window.addEventListener('keydown', handleFocusShortcut)
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleFocusShortcut)
})
</script>

<template>
  <div dark="bg-$bg-c" class="relative mx-auto w-full flex bg-gray-200 h-44 sm:w-[700px]!">
    <div
      v-show="showKeyDownSel && noticeKeyList.length > 1"
      v-on-click-outside="handleKeyRecomend"
      class="absolute z-9 w-full h-10em t-100p"
      @mouseleave="handleLeave()"
    >
      <div bg="$main-bg-c" class="z-9 py-6 border-2 l-0 t-0 t-100p">
        <div
          v-for="(item, i) in noticeKeyList.slice(1)" :key="i + 1" class="cursor-pointer text-15 p-5"
          :class="{ 'bg-$site-hover-c': i + 1 === selectedIndex }"
          @mouseover="handleHover(i + 1)"
          @click="jumpSearch(i + 1)"
          @touchstart="setActive(i + 1)"
          @touchend="setInactive(i + 1)"
        >
          <div class="flex-left gap-x-8" style="margin: 0.75rem; margin-left: 2rem;">
            <div>{{ item }}</div>
          </div>
        </div>
      </div>
    </div>
    <div v-on-click-outside="() => selectionVisible = false" class="relative flex-center shrink-0 w-44">
      <div hover="op-100" class="h-full w-full flex-center cursor-pointer op-80 transition-300" @click="toggleSelection">
        <img :src="_getFavicon(searchList[curSearchIndex].value)" :style="iconStyle" class="h-32 w-32">
      </div>
      <div v-show="selectionVisible" bg="$main-bg-c" class="absolute z-9 border-2 l-0 t-0 t-100p w-200">
        <div
          v-for="(item, i) in searchList"
          :key="i"
          hover="bg-$site-hover-c"
          class="flex cursor-pointer items-center justify-between px-12 py-7"
          @click="changeSearch(i)"
        >
          <div class="$text-c-1 flex-center gap-x-8 text-15">
            <img :src="_getFavicon(item.value)" :style="iconStyle" class="circle h-20 w-20">
            <div>{{ getText(item.name) }}</div>
            <div class="ml-4 font-300">{{ `#${item.value.s}` }}</div>
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
        class="$text-c-1 h-full w-full text-15 op-80 bg-white"
        @keydown.enter="search"
        @input="handleInput"
        @focus="handleFocus"
        @keydown="handleKeydown"
        @keydown.down.exact="keyNext"
        @keydown.up.exact="keyPrev"
        @keydown.ctrl.n.exact="keyNext"
        @keydown.ctrl.p.exact="keyPrev"
      >
      <div
        v-if="keyword.length > 0"
        hover="op-80"
        class="i-carbon:close mr-8 cursor-pointer text-20 op-40 transition duration-300"
        @click="handleCloseClick"
      />
    </div>
    <button class="flex-center shrink-0 gap-x-4 px-16 btn" @click="search">
      <span class="i-carbon:search inline-block text-16" />
    </button>
  </div>
</template>
