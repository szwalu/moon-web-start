<script setup lang="ts">
import { computed, defineExpose, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Heart,
  Image as ImageIcon,
  Link as LinkIcon,
  Mic,
  Search,
  X,
} from 'lucide-vue-next'
import { supabase } from '@/utils/supabaseClient'
import { getSearchCacheKey } from '@/utils/cacheKeys'

// --- Props and Emits ---
const props = defineProps({
  modelValue: { type: String, required: true },
  isExporting: { type: Boolean, default: false },
  showExportButton: { type: Boolean, default: true },
  allTags: { type: Array as () => string[], default: () => [] },
  searchQuery: { type: String, default: '' },
  user: { type: Object as () => { id?: string }, required: true },
})

const emit = defineEmits([
  'update:modelValue',
  'export',
  'searchStarted',
  'searchCompleted',
  'searchCleared',
])

const searchInputRef = ref<HTMLInputElement | null>(null)

// --- 初始化 & 状态 ---
const { t } = useI18n()
const showSearchTagSuggestions = ref(false)
const searchTagSuggestions = ref<string[]>([])
const highlightedSearchIndex = ref(-1)

// ====== 界面显示状态 ======
const showAdvancedFilters = ref(false)

// ====== 筛选弹窗相关状态 ======
const showDateModal = ref(false)
const showTagModal = ref(false)
const showMoreModal = ref(false)

// 日期筛选
const dateMode = ref<'all' | 'week' | 'month' | 'custom'>('all')
const startDateStr = ref('')
const endDateStr = ref('')

// 标签筛选
const tagMode = ref<'all' | 'untagged' | 'include' | 'exclude'>('all')
const selectedTagForFilter = ref('')

// 更多筛选
const moreHasImage = ref(false)
const moreHasLink = ref(false)
const audioFilterEnabled = ref(false)
const favoriteOnly = ref(false)

// ====== 最近搜索历史 ======
const HISTORY_KEY = 'NOTES_SEARCH_HISTORY_V1'
const recentSearches = ref<string[]>([])

onMounted(() => {
  searchInputRef.value?.focus()
  loadSearchHistory()
})

function loadSearchHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (raw)
      recentSearches.value = JSON.parse(raw)
  }
  catch (e) {
    console.error(e)
  }
}

function saveSearchHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(recentSearches.value))
}

function addToHistory(term: string) {
  const cleanTerm = term.trim()
  if (!cleanTerm)
    return

  const idx = recentSearches.value.indexOf(cleanTerm)
  if (idx > -1)
    recentSearches.value.splice(idx, 1)

  recentSearches.value.unshift(cleanTerm)
  if (recentSearches.value.length > 10)
    recentSearches.value = recentSearches.value.slice(0, 10)

  saveSearchHistory()
}

function removeHistoryItem(term: string) {
  const idx = recentSearches.value.indexOf(term)
  if (idx > -1) {
    recentSearches.value.splice(idx, 1)
    saveSearchHistory()
  }
}

function clearAllHistory() {
  recentSearches.value = []
  localStorage.removeItem(HISTORY_KEY)
}

// ====== 计算属性 ======
const hasAnyFilter = computed(() => {
  const hasDate = dateMode.value !== 'all' || !!startDateStr.value || !!endDateStr.value
  const hasTag = tagMode.value !== 'all' || !!selectedTagForFilter.value
  const hasMore = moreHasImage.value || moreHasLink.value || audioFilterEnabled.value || favoriteOnly.value
  return hasDate || hasTag || hasMore
})

const dateLabel = computed(() => {
  switch (dateMode.value) {
    case 'week': return t('notes.search_filter_date_this_week', '本周')
    case 'month': return t('notes.search_filter_date_this_month', '本月')
    case 'custom': return t('notes.search_filter_date_custom', '自定义')
    default: return t('notes.search_filter_date', '日期')
  }
})

const tagLabel = computed(() => {
  switch (tagMode.value) {
    case 'untagged': return t('notes.search_filter_tag_untagged', '无标签')
    case 'include': return t('notes.search_filter_tag_include', '包含标签')
    case 'exclude': return t('notes.search_filter_tag_exclude', '排除标签')
    default: return t('notes.search_filter_tag', '标签')
  }
})

const moreLabel = computed(() => {
  const parts: string[] = []
  if (moreHasImage.value)
    parts.push(t('notes.search_quick_has_image', '有图片'))

  if (moreHasLink.value)
    parts.push(t('notes.search_quick_has_link', '有链接'))

  if (audioFilterEnabled.value)
    parts.push(t('notes.search_quick_has_audio', '有语音'))

  if (!parts.length)
    return t('notes.search_filter_more', '更多')

  return parts.join('、')
})

const searchModel = computed({
  get: () => props.modelValue,
  set: (value) => {
    emit('update:modelValue', value)
  },
})

// ✅ 修复：点击历史记录，直接回填搜索框并执行（恢复旧版逻辑）
function applyHistorySearch(term: string) {
  // 1. 将关键词回填到输入框显示
  searchModel.value = term

  // 2. ✅ 关键修改：直接把 term 传给 executeSearch
  // 这样能避开 props 更新的微小延迟，确保立刻搜的是这个词
  executeSearch(term)
}

// ====== 搜索逻辑 ======
function getNoteRaw(note: any): string {
  if (!note)
    return ''

  let text = ''
  if (typeof note.content === 'string')
    text += note.content

  if (typeof note.weather === 'string')
    text += ` ${note.weather}`

  if (!text) {
    try {
      return JSON.stringify(note)
    }
    catch {
      return ''
    }
  }
  return text
}

function isAudioNote(note: any): boolean {
  const raw = getNoteRaw(note)
  let hit = 0

  if (raw.includes('note-audios/'))
    hit++

  if (raw.includes('.webm'))
    hit++

  if (raw.includes('录音'))
    hit++

  return hit >= 2
}

function noteHasImage(note: any): boolean {
  return getNoteRaw(note).includes('note-images/')
}

function noteHasLink(note: any): boolean {
  const raw = getNoteRaw(note)
  return raw.includes('https://') || raw.includes('http://')
}

const autoLabelTokens = computed(() => [
  t('notes.search_quick_has_image', '有图片'),
  t('notes.search_quick_has_audio', '有语音'),
  t('notes.search_quick_has_link', '有链接'),
  t('notes.search_quick_favorited', '已收藏'),
])

function stripAutoLabels(raw: string): string {
  let q = raw
  autoLabelTokens.value.forEach((label) => {
    if (!label)
      return

    q = q.split(label).join('')
  })
  return q.replace(/\s+/g, ' ').trim()
}

function isPureAutoLabelQuery(raw: string): boolean {
  const q = raw.trim()
  if (!q)
    return false

  const tokens = q.split(/\s+/g).filter(Boolean)
  if (!tokens.length)
    return false

  const labels = autoLabelTokens.value
  return tokens.every(tok => labels.includes(tok))
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d, 0, 0, 0, 0)
}

function formatLocalDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getDateRange() {
  const now = new Date()
  let start: Date | null = null
  let end: Date | null = null

  if (dateMode.value === 'week') {
    const day = now.getDay() || 7
    const monday = new Date(now)
    monday.setHours(0, 0, 0, 0)
    monday.setDate(now.getDate() - (day - 1))
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 7)
    start = monday
    end = sunday
  }
  else if (dateMode.value === 'month') {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
    const nextMonthFirst = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    start = firstDay
    end = nextMonthFirst
  }
  else if (dateMode.value === 'custom') {
    if (startDateStr.value) {
      const d = parseLocalDate(startDateStr.value)
      d.setHours(0, 0, 0, 0)
      start = d
    }
    if (endDateStr.value) {
      const d = parseLocalDate(endDateStr.value)
      d.setHours(23, 59, 59, 999)
      end = d
    }
  }
  return { start, end }
}

function inDateRange(note: any): boolean {
  const { start, end } = getDateRange()
  if (!start && !end)
    return true

  if (!note?.created_at)
    return false

  const d = new Date(note.created_at)
  if (Number.isNaN(d.getTime()))
    return false

  if (start && d < start)
    return false

  if (end && d > end)
    return false

  return true
}

function matchTagFilter(note: any): boolean {
  const raw = getNoteRaw(note)
  if (tagMode.value === 'all')
    return true

  if (tagMode.value === 'untagged')
    return !raw.includes('#')

  if (!selectedTagForFilter.value)
    return true

  const tag = selectedTagForFilter.value
  if (tagMode.value === 'include')
    return raw.includes(tag)

  if (tagMode.value === 'exclude')
    return !raw.includes(tag)

  return true
}

function matchKeyword(raw: string, keyword: string): boolean {
  const q = keyword.trim()
  if (!q)
    return true

  const tokens = q.split(/\s+/).filter(Boolean)
  if (!tokens.length)
    return true

  return tokens.every(token => raw.includes(token))
}

function applyAllFilters(list: any[], keyword: string) {
  return list
    .filter((note) => {
      const raw = getNoteRaw(note)
      if (!matchKeyword(raw, keyword))
        return false

      if (!inDateRange(note))
        return false

      if (!matchTagFilter(note))
        return false

      if (moreHasImage.value && !noteHasImage(note))
        return false

      if (audioFilterEnabled.value && !isAudioNote(note))
        return false

      if (moreHasLink.value && !noteHasLink(note))
        return false

      if (favoriteOnly.value && note.is_favorited === false)
        return false

      return true
    })
    .map((n: any) => ({
      ...n,
      highlight: null,
      is_fts: false,
      terms: [],
    }))
}

function buildSearchPayload(termOverride?: string) {
  const raw = typeof termOverride === 'string' ? termOverride : searchModel.value
  const rawQuery = raw.trim()
  const queryWithoutAuto = isPureAutoLabelQuery(rawQuery) ? '' : stripAutoLabels(rawQuery)

  const payload: Record<string, any> = { p_user_id: props.user.id }
  payload.search_term = queryWithoutAuto || null

  if (dateMode.value === 'custom') {
    if (startDateStr.value || endDateStr.value) {
      payload.date_mode = 'custom'
      payload.date_start = startDateStr.value || null
      payload.date_end = endDateStr.value || null
    }
    else {
      payload.date_mode = 'all'
      payload.date_start = null
      payload.date_end = null
    }
  }
  else {
    const { start, end } = getDateRange()
    if (start || end) {
      payload.date_mode = 'custom'
      payload.date_start = start ? formatLocalDate(start) : null
      payload.date_end = end ? formatLocalDate(end) : null
    }
    else {
      payload.date_mode = 'all'
      payload.date_start = null
      payload.date_end = null
    }
  }

  payload.tag_mode = tagMode.value
  payload.tag_value = (tagMode.value === 'include' || tagMode.value === 'exclude') ? (selectedTagForFilter.value || null) : null
  payload.has_image = moreHasImage.value
  payload.has_link = moreHasLink.value
  payload.favorite_only = favoriteOnly.value
  payload.has_audio = audioFilterEnabled.value

  return { payload, queryBase: queryWithoutAuto }
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < array.length; i += size)
    result.push(array.slice(i, i + size))
  return result
}

async function executeSearch(termOverride?: string) {
  if (!props.user?.id)
    return

  const { payload, queryBase } = buildSearchPayload(termOverride)

  if (!queryBase && !hasAnyFilter.value) {
    emit('searchCleared')
    return
  }

  if (queryBase && queryBase.length > 0)
    addToHistory(queryBase)

  const currentDbVersion = localStorage.getItem('NOTES_DB_VERSION') || '0'
  const cacheKey = getSearchCacheKey(JSON.stringify({
    q: queryBase || '',
    dm: dateMode.value,
    ds: startDateStr.value,
    de: endDateStr.value,
    tm: tagMode.value,
    tag: selectedTagForFilter.value,
    img: moreHasImage.value,
    link: moreHasLink.value,
    audioFilter: audioFilterEnabled.value,
    favoriteOnly: favoriteOnly.value,
  }))

  emit('searchStarted')

  const cachedRaw = localStorage.getItem(cacheKey)
  if (cachedRaw) {
    try {
      const cachedObj = JSON.parse(cachedRaw)
      if (cachedObj && cachedObj.v === currentDbVersion && Array.isArray(cachedObj.d)) {
        const finalData = applyAllFilters(cachedObj.d, queryBase)
        emit('searchCompleted', { data: finalData, error: null, fromCache: true })
        return
      }
    }
    catch (e) {
      localStorage.removeItem(cacheKey)
    }
  }

  try {
    const rpcPromise = supabase.rpc('search_notes_with_highlight', payload)
    let weatherPromise = Promise.resolve({ data: [], error: null })
    if (queryBase) {
      weatherPromise = supabase
        .from('notes')
        .select('*')
        .eq('user_id', props.user.id)
        .ilike('weather', `%${queryBase}%`)
        .order('created_at', { ascending: false })
        .limit(50) as any
    }

    const [rpcRes, weatherRes] = await Promise.all([rpcPromise, weatherPromise])

    if (rpcRes.error)
      throw rpcRes.error

    const rpcData = Array.isArray(rpcRes.data) ? rpcRes.data : []
    const weatherData = Array.isArray(weatherRes.data) ? weatherRes.data : []

    const combinedMap = new Map()
    rpcData.forEach((item: any) => combinedMap.set(item.id, item))
    weatherData.forEach((item: any) => {
      if (!combinedMap.has(item.id))
        combinedMap.set(item.id, item)
    })

    let data = Array.from(combinedMap.values())

    const idsToCheck = data.map((n: any) => n.id)
    if (idsToCheck.length) {
      const BATCH_SIZE = 50
      const chunks = chunkArray(idsToCheck, BATCH_SIZE)
      const metaPromises = chunks.map(chunkIds =>
        supabase.from('notes').select('id, weather, is_favorited, is_pinned').in('id', chunkIds),
      )
      const responses = await Promise.all(metaPromises)
      let allMetaRows: any[] = []
      responses.forEach(({ data: chunkData, error: chunkError }) => {
        if (!chunkError && chunkData)
          allMetaRows = allMetaRows.concat(chunkData)
      })

      if (allMetaRows.length) {
        const metaMap = new Map(allMetaRows.map(r => [r.id, r]))
        data = data.map((n: any) => {
          const meta = metaMap.get(n.id)
          return {
            ...n,
            weather: n.weather ?? meta?.weather ?? null,
            is_favorited: n.is_favorited ?? meta?.is_favorited ?? false,
            is_pinned: n.is_pinned ?? meta?.is_pinned ?? false,
          }
        })
      }
    }

    const list = Array.isArray(data) ? data : []
    const finalData = applyAllFilters(list, queryBase)

    const cachePayload = { v: currentDbVersion, d: list }
    if (JSON.stringify(cachePayload).length < 500000)
      localStorage.setItem(cacheKey, JSON.stringify(cachePayload))

    emit('searchCompleted', { data: finalData, error: null, fromCache: false })
  }
  catch (err: any) {
    console.error('Search failed:', err)
    emit('searchCompleted', { data: [], error: err, fromCache: false })
  }
}

function handleQuickSearch(type: 'image' | 'audio' | 'link' | 'favorite') {
  showSearchTagSuggestions.value = false
  highlightedSearchIndex.value = -1

  moreHasImage.value = false
  moreHasLink.value = false
  audioFilterEnabled.value = false
  favoriteOnly.value = false

  if (type === 'image')
    moreHasImage.value = true

  else if (type === 'audio')
    audioFilterEnabled.value = true

  else if (type === 'link')
    moreHasLink.value = true

  else if (type === 'favorite')
    favoriteOnly.value = true

  // ✅ 修复：如果搜索框空，回填文字（恢复旧版逻辑）
  if (!searchModel.value.trim()) {
    const keywords: string[] = []
    if (moreHasImage.value)
      keywords.push(t('notes.search_quick_has_image', '有图片'))

    if (moreHasLink.value)
      keywords.push(t('notes.search_quick_has_link', '有链接'))

    if (audioFilterEnabled.value)
      keywords.push(t('notes.search_quick_has_audio', '有语音'))

    if (favoriteOnly.value)
      keywords.push(t('notes.search_quick_favorited', '已收藏'))

    if (keywords.length)
      searchModel.value = keywords.join(' ')
  }
  executeSearch()
}

// ✅ 修复：日期筛选回填文字到搜索框
function confirmDateFilter() {
  if (startDateStr.value || endDateStr.value)
    dateMode.value = 'custom'

  else if (dateMode.value === 'custom')
    dateMode.value = 'all'

  if (!searchModel.value.trim()) {
    if (dateMode.value === 'week') {
      searchModel.value = t('notes.search_filter_date_this_week', '本周')
    }
    else if (dateMode.value === 'month') {
      searchModel.value = t('notes.search_filter_date_this_month', '本月')
    }
    else if (dateMode.value === 'custom') {
      const start = startDateStr.value || '...'
      const end = endDateStr.value || '...'
      searchModel.value = `${start} ~ ${end}`
    }
  }
  showDateModal.value = false
  executeSearch()
}

// ✅ 修复：标签筛选回填文字到搜索框
function confirmTagFilter() {
  if (tagMode.value !== 'include' && tagMode.value !== 'exclude')
    selectedTagForFilter.value = ''

  if (!searchModel.value.trim()) {
    if (tagMode.value === 'untagged') {
      searchModel.value = t('notes.search_filter_tag_untagged', '无标签')
    }
    else if (selectedTagForFilter.value) {
      if (tagMode.value === 'exclude') {
        const prefix = t('notes.search_filter_tag_exclude', '排除')
        searchModel.value = `${prefix} ${selectedTagForFilter.value}`
      }
      else {
        searchModel.value = selectedTagForFilter.value
      }
    }
  }
  showTagModal.value = false
  executeSearch()
}

// ✅ 修复：更多筛选回填文字到搜索框
function confirmMoreFilter() {
  if (!searchModel.value.trim()) {
    const keywords: string[] = []
    if (moreHasImage.value)
      keywords.push(t('notes.search_quick_has_image', '有图片'))

    if (moreHasLink.value)
      keywords.push(t('notes.search_quick_has_link', '有链接'))

    if (audioFilterEnabled.value)
      keywords.push(t('notes.search_quick_has_audio', '有语音'))

    if (favoriteOnly.value)
      keywords.push(t('notes.search_quick_favorited', '已收藏'))

    if (keywords.length)
      searchModel.value = keywords.join(' ')
  }
  showMoreModal.value = false
  executeSearch()
}

function handleSearchQueryChange(query: string) {
  if (!query) {
    clearSearch()
    return
  }
  const lastHashIndex = query.lastIndexOf('#')
  if (lastHashIndex !== -1 && (lastHashIndex === 0 || /\s/.test(query[lastHashIndex - 1]))) {
    const term = query.substring(lastHashIndex + 1)
    const potentialTag = query.substring(lastHashIndex)
    if (!/\s/.test(potentialTag)) {
      searchTagSuggestions.value = props.allTags.filter(tag =>
        tag.toLowerCase().startsWith(`#${term.toLowerCase()}`),
      )
      showSearchTagSuggestions.value = searchTagSuggestions.value.length > 0
      highlightedSearchIndex.value = 0
    }
    else {
      showSearchTagSuggestions.value = false
    }
  }
  else {
    showSearchTagSuggestions.value = false
  }
}

function selectSearchTag(tag: string) {
  if (!tag)
    return

  const lastHashIndex = searchModel.value.lastIndexOf('#')
  if (lastHashIndex !== -1)
    searchModel.value = `${searchModel.value.substring(0, lastHashIndex) + tag} `

  else
    searchModel.value = `${tag} `

  showSearchTagSuggestions.value = false
  searchInputRef.value?.focus()
}

function moveSearchSelection(offset: number) {
  if (showSearchTagSuggestions.value && searchTagSuggestions.value.length > 0) {
    const len = searchTagSuggestions.value.length
    highlightedSearchIndex.value = (highlightedSearchIndex.value + offset + len) % len
  }
}

function handleEnterKey() {
  if (showSearchTagSuggestions.value && highlightedSearchIndex.value > -1)
    selectSearchTag(searchTagSuggestions.value[highlightedSearchIndex.value])

  else
    executeSearch()
}

function clearSearch() {
  searchModel.value = ''
  searchInputRef.value?.focus()
  dateMode.value = 'all'
  startDateStr.value = ''
  endDateStr.value = ''
  tagMode.value = 'all'
  selectedTagForFilter.value = ''
  moreHasImage.value = false
  moreHasLink.value = false
  audioFilterEnabled.value = false
  favoriteOnly.value = false
  emit('searchCleared')
}

defineExpose({ executeSearch, clearSearch })
</script>

<template>
  <div class="search-export-bar">
    <div class="search-input-wrapper">
      <div class="search-icon-wrapper">
        <Search class="icon-search" :size="18" />
      </div>

      <input
        ref="searchInputRef"
        v-model="searchModel"
        type="text"
        :placeholder="t('notes.search_placeholder_enter', '输入后按回车搜索...')"
        class="search-input"
        autocomplete="off"
        @input="handleSearchQueryChange($event.target.value)"
        @keydown.down.prevent="moveSearchSelection(1)"
        @keydown.up.prevent="moveSearchSelection(-1)"
        @keydown.enter.prevent="handleEnterKey"
        @keydown.esc="showSearchTagSuggestions.value = false"
      >

      <button
        v-if="searchModel"
        class="clear-search-button"
        title="清空"
        @click="clearSearch"
      >
        <X :size="12" />
      </button>

      <button
        class="submit-search-button"
        title="搜索"
        @click="handleEnterKey"
      >
        <ArrowRight :size="18" />
      </button>

      <div
        v-if="showSearchTagSuggestions && searchTagSuggestions.length"
        class="tag-suggestions search-suggestions"
      />
    </div>

    <div class="controls-row">
      <div v-if="!showAdvancedFilters" class="quick-search-title">
        {{ t('notes.search_quick_title', '快捷搜索') }}
      </div>

      <button
        class="advanced-toggle-btn"
        @click="showAdvancedFilters = !showAdvancedFilters"
      >
        <span>{{ t('notes.search_advanced', '高级搜索') }}</span>
        <ChevronUp v-if="showAdvancedFilters" :size="16" />
        <ChevronDown v-else :size="16" />
      </button>
    </div>

    <div v-show="showAdvancedFilters" class="filter-row">
      <button class="filter-chip" type="button" @click="showDateModal = true">
        <span>{{ dateLabel }}</span>
        <ChevronDown :size="14" class="filter-caret" />
      </button>
      <button class="filter-chip" type="button" @click="showTagModal = true">
        <span>{{ tagLabel }}</span>
        <ChevronDown :size="14" class="filter-caret" />
      </button>
      <button class="filter-chip" type="button" @click="showMoreModal = true">
        <span>{{ moreLabel }}</span>
        <ChevronDown :size="14" class="filter-caret" />
      </button>
    </div>

    <div v-if="!searchModel" class="quick-search-section">
      <div v-if="showAdvancedFilters" class="quick-search-title moved-down">
        {{ t('notes.search_quick_title', '快捷搜索') }}
      </div>

      <div class="quick-search-grid">
        <button class="quick-chip" type="button" @click="handleQuickSearch('image')">
          <ImageIcon :size="15" class="chip-icon" />
          <span>{{ t('notes.search_quick_has_image', '有图片') }}</span>
        </button>
        <button class="quick-chip" type="button" @click="handleQuickSearch('audio')">
          <Mic :size="15" class="chip-icon" />
          <span>{{ t('notes.search_quick_has_audio', '有语音') }}</span>
        </button>
        <button class="quick-chip" type="button" @click="handleQuickSearch('link')">
          <LinkIcon :size="15" class="chip-icon" />
          <span>{{ t('notes.search_quick_has_link', '有链接') }}</span>
        </button>
        <button class="quick-chip" type="button" @click="handleQuickSearch('favorite')">
          <Heart :size="15" class="chip-icon" />
          <span>{{ t('notes.search_quick_favorited', '已收藏') }}</span>
        </button>
      </div>
    </div>

    <div v-if="!searchModel && recentSearches.length > 0" class="recent-search-section">
      <div class="section-header">
        <span class="quick-search-title">{{ t('notes.search_history_title', '最近搜索') }}</span>
        <button class="clear-history-btn" :title="t('common.clear', '清空')" @click="clearAllHistory">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
      <div class="history-chips-container">
        <div
          v-for="item in recentSearches"
          :key="item"
          class="history-chip"
          @click="applyHistorySearch(item)"
        >
          <span>{{ item }}</span>
          <button class="history-delete-btn" @click.stop="removeHistoryItem(item)">
            <X :size="14" />
          </button>
        </div>
      </div>
    </div>

    <div v-if="showDateModal" class="sheet-mask" @click.self="showDateModal = false">
      <div class="sheet-panel">
        <div class="sheet-header">
          <div class="sheet-title">
            {{ t('notes.search_date_title', '日期范围') }}
          </div>
          <button class="sheet-close" type="button" @click="showDateModal = false">
            <X :size="20" />
          </button>
        </div>
        <div class="sheet-body">
          <div class="seg-row">
            <button class="seg-btn" :class="{ active: dateMode === 'all' }" type="button" @click="dateMode = 'all'; startDateStr = ''; endDateStr = ''">
              {{ t('notes.search_date_all', '不限时间') }}
            </button>
            <button class="seg-btn" :class="{ active: dateMode === 'week' }" type="button" @click="dateMode = 'week'; startDateStr = ''; endDateStr = ''">
              {{ t('notes.search_date_this_week', '本周') }}
            </button>
            <button class="seg-btn" :class="{ active: dateMode === 'month' }" type="button" @click="dateMode = 'month'; startDateStr = ''; endDateStr = ''">
              {{ t('notes.search_date_this_month', '本月') }}
            </button>
          </div>
          <div class="date-input-row">
            <div class="date-input-wrapper">
              <span class="date-label">{{ t('notes.search_date_start', '开始日期') }}</span>
              <input v-model="startDateStr" type="date" class="date-input">
            </div>
            <div class="date-separator">
              —
            </div>
            <div class="date-input-wrapper">
              <span class="date-label">{{ t('notes.search_date_end', '结束日期') }}</span>
              <input v-model="endDateStr" type="date" class="date-input">
            </div>
          </div>
        </div>
        <button class="sheet-confirm-btn" type="button" @click="confirmDateFilter">
          {{ t('common.confirm', '确定') }}
        </button>
      </div>
    </div>

    <div v-if="showTagModal" class="sheet-mask" @click.self="showTagModal = false">
      <div class="sheet-panel">
        <div class="sheet-header">
          <div class="sheet-title">
            {{ t('notes.search_tag_title', '标签范围') }}
          </div>
          <button class="sheet-close" type="button" @click="showTagModal = false">
            <X :size="20" />
          </button>
        </div>
        <div class="sheet-body">
          <div class="tag-mode-grid">
            <button class="tag-mode-btn" :class="{ active: tagMode === 'all' }" type="button" @click="tagMode = 'all'; selectedTagForFilter = ''">
              {{ t('notes.search_tag_all', '全部内容') }}
            </button>
            <button class="tag-mode-btn" :class="{ active: tagMode === 'untagged' }" type="button" @click="tagMode = 'untagged'; selectedTagForFilter = ''">
              {{ t('notes.search_tag_untagged', '无标签') }}
            </button>
            <button class="tag-mode-btn" :class="{ active: tagMode === 'include' }" type="button" @click="tagMode = 'include'">
              {{ t('notes.search_tag_include', '包含指定标签') }}
            </button>
            <button class="tag-mode-btn" :class="{ active: tagMode === 'exclude' }" type="button" @click="tagMode = 'exclude'">
              {{ t('notes.search_tag_exclude', '排除指定标签') }}
            </button>
          </div>
          <div v-if="tagMode === 'include' || tagMode === 'exclude'" class="tag-select-row">
            <div class="tag-select-label">
              {{ t('notes.search_tag_pick_label', '选择标签') }}
            </div>
            <select v-model="selectedTagForFilter" class="tag-select">
              <option value="">
                {{ t('notes.search_tag_pick_placeholder', '请选择标签') }}
              </option>
              <option v-for="tag in props.allTags" :key="tag" :value="tag">
                {{ tag }}
              </option>
            </select>
          </div>
        </div>
        <button class="sheet-confirm-btn" type="button" @click="confirmTagFilter">
          {{ t('common.confirm', '确定') }}
        </button>
      </div>
    </div>

    <div v-if="showMoreModal" class="sheet-mask" @click.self="showMoreModal = false">
      <div class="sheet-panel">
        <div class="sheet-header">
          <div class="sheet-title">
            {{ t('notes.search_more_title', '更多条件') }}
          </div>
          <button class="sheet-close" type="button" @click="showMoreModal = false">
            <X :size="20" />
          </button>
        </div>
        <div class="sheet-body">
          <ul class="more-list">
            <li class="more-item" @click="moreHasImage = !moreHasImage">
              {{ t('notes.search_quick_has_image', '有图片') }}<span v-if="moreHasImage" class="check-icon">✓</span>
            </li>
            <li class="more-item" @click="moreHasLink = !moreHasLink">
              {{ t('notes.search_quick_has_link', '有链接') }}<span v-if="moreHasLink" class="check-icon">✓</span>
            </li>
            <li class="more-item" @click="audioFilterEnabled = !audioFilterEnabled">
              {{ t('notes.search_quick_has_audio', '有语音') }}<span v-if="audioFilterEnabled" class="check-icon">✓</span>
            </li>
          </ul>
        </div>
        <button class="sheet-confirm-btn" type="button" @click="confirmMoreFilter">
          {{ t('common.confirm', '确定') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 容器 */
.search-export-bar {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  position: -webkit-sticky;
  position: sticky;
  top: 0;
  z-index: 20;
  background-color: #f3f4f6;
  padding-top: 1rem;
  padding-bottom: 0.5rem;
  margin-bottom: 0.5rem;
}
.dark .search-export-bar { background-color: #374151; }

/* 1. 搜索框行 */
.search-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}
.search-icon-wrapper {
  position: absolute;
  left: 1rem;
  top: 50%;
  transform: translateY(-50%);
  color: #9ca3af;
  pointer-events: none;
  display: flex;
}
.dark .search-icon-wrapper { color: #6b7280; }

/* 1. 输入框预留位置 */
.search-input {
  flex: 1;
  width: 100%;
  height: 36px;
  /* 右边距 5.5rem 确保不挡住两个按钮 */
  padding: 0 5.5rem 0 6.2rem;
  font-size: 15px;
  border: 1px solid transparent;
  border-radius: 12px;
  background-color: #fff;
  color: #111;
  box-shadow: 0 2px 5px rgba(0,0,0,0.03);
  transition: all 0.2s;
}

/* 2. 灰色小 X 按钮 - 基础样式 */
.clear-search-button {
  position: absolute;
  /* 位于搜索按钮(28px + gap)的左边，大约 3rem 位置 */
  right: 11rem;
  top: 50%;
  transform: translateY(-50%);

  /* 灰色圆形背景 */
  background-color: #e5e7eb;
  color: #6b7280;

  border: none;
  cursor: pointer;
  width: 20px;   /* 小尺寸 */
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  z-index: 15; /* 确保层级比 input 高 */
}

/* 悬停效果 */
.clear-search-button:hover {
  background-color: #d1d5db;
  color: #374151;
}

/* 深色模式适配 */
.dark .clear-search-button {
  background-color: #4b5563;
  color: #d1d5db;
}
.dark .clear-search-button:hover {
  background-color: #6b7280;
  color: #fff;
}
.dark .search-input {
  background-color: #2c2c2e;
  color: #fff;
  box-shadow: none;
}
.search-input:focus {
  background-color: #fff;
  border-color: #00b386;
  box-shadow: 0 0 0 2px rgba(0,179,134,0.1);
  outline: none;
}
.dark .search-input:focus {
  background-color: #2c2c2e;
}

/* 1. 修改输入框样式：加大右侧 padding 给两个按钮留位置 */
.search-input {
  flex: 1;
  width: 100%;
  height: 36px;
  /* 左边距保持 6.2rem，右边距加大到 5.5rem (容纳 X 按钮和 搜索按钮) */
  padding: 0 5.5rem 0 6.2rem;
  font-size: 15px;
  border: 1px solid transparent;
  border-radius: 12px;
  background-color: #fff;
  color: #111;
  box-shadow: 0 2px 5px rgba(0,0,0,0.03);
  transition: all 0.2s;
}

/* 3. 新增：搜索确认按钮样式 (固定在最右侧) */
.submit-search-button {
  position: absolute;
  right: 0.6rem;
  top: 50%;
  transform: translateY(-50%);
  background-color: #6366f1; /* 使用与高级搜索按钮一致的靛蓝色 */
  color: #ffffff;
  border: none;
  cursor: pointer;
  width: 28px; /* 比清除按钮稍大，方便点击 */
  height: 28px;
  border-radius: 8px; /* 圆角矩形，与整体风格统一 */
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 2px rgba(0,0,0,0.15);
  transition: all 0.2s ease;
  z-index: 10;
}

.submit-search-button:hover {
  background-color: #4f46e5;
  transform: translateY(-50%) scale(1.05);
}
.submit-search-button:active {
  transform: translateY(-50%) scale(0.95);
}

.dark .submit-search-button {
  background-color: #818cf8;
  color: #1f2937;
}
.submit-search-button {
  position: absolute;
  right: 0.6rem;
  top: 50%;
  transform: translateY(-50%);
  background-color: #6366f1; /* 使用与高级搜索按钮一致的靛蓝色 */
  color: #ffffff;
  border: none;
  cursor: pointer;
  width: 28px; /* 比清除按钮稍大，方便点击 */
  height: 28px;
  border-radius: 8px; /* 圆角矩形，与整体风格统一 */
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 2px rgba(0,0,0,0.15);
  transition: all 0.2s ease;
  z-index: 10;
}
.submit-search-button:hover {
  background-color: #4f46e5;
  transform: translateY(-50%) scale(1.05);
}
.submit-search-button:active {
  transform: translateY(-50%) scale(0.95);
}

.dark .submit-search-button {
  background-color: #818cf8;
  color: #1f2937;
}
.clear-search-button:hover {
  background-color: #7c3aed;
  transform: translateY(-50%) scale(1.1);
}
.dark .clear-search-button {
  background-color: #a78bfa;
  color: #1f2937;
}

/* 2. 控制行 (标题左，按钮右) */
.controls-row {
  display: flex;
  align-items: center;
  /* 关键：让左边的标题和右边的按钮分列两端 */
  /* 如果标题隐藏了，按钮依然会因为 margin-left: auto 靠右 */
  justify-content: space-between;
  margin-top: 4px;
  padding: 0 2px;
  min-height: 24px; /* 防止标题消失时高度塌陷 */
}
.quick-search-title {
  font-size: 13px;
  font-weight: 500;
  color: #6b7280;
  /* 默认情况（在第一行时）不需要下边距 */
  margin: 0;
}
.dark .quick-search-title { color: #9ca3af; }

.quick-search-title.moved-down {
  margin-bottom: 8px;
  margin-left: 4px;
  margin-top: 4px; /* 与上面的筛选条拉开一点距离 */
}

.advanced-toggle-btn {
  /* 关键：确保即使左边没有标题，它也永远贴在右边 */
  margin-left: auto;

  background: transparent;
  border: none;
  color: #6366f1;
  font-size: 13px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
}
.advanced-toggle-btn:hover { background-color: rgba(99, 102, 241, 0.1); }
.dark .advanced-toggle-btn { color: #818cf8; }
.dark .advanced-toggle-btn:hover { background-color: rgba(129, 140, 248, 0.15); }
/* 3. 快捷搜索按钮组 (网格布局) */
.quick-search-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr); /* 四等分 */
  gap: 8px;
  margin-top: 4px;
}

.quick-chip {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 4px;

  height: 32px;
  padding: 0 4px;
  font-size: 13px;
  border-radius: 8px;
  border: 1px solid transparent;
  background-color: #fff;
  color: #374151;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
  transition: all 0.15s;
  white-space: nowrap;
}
.dark .quick-chip {
  background-color: #4b5563;
  color: #e5e7eb;
  box-shadow: none;
}
.quick-chip:hover {
  transform: translateY(-1px);
  box-shadow: 0 3px 6px rgba(0,0,0,0.08);
}
.quick-chip:active {
  transform: translateY(0);
}
.chip-icon {
  opacity: 0.7;
  color: #6366f1;
}

/* 4. 高级筛选面板 */
.filter-row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  margin-bottom: 8px; /* 增加底部间距 */
  padding: 0 2px;
  animation: slideDown 0.2s ease-out;
}

.quick-search-section {
  display: flex;
  flex-direction: column;
}
@keyframes slideDown {
  from { opacity: 0; transform: translateY(-5px); }
  to { opacity: 1; transform: translateY(0); }
}

.filter-chip {
  flex: 1;
  padding: 0 12px;
  height: 32px;
  font-size: 13px;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  background-color: #fff;
  color: #374151;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.dark .filter-chip {
  background-color: #2c2c2e;
  border-color: #48484a;
  color: #e5e7eb;
}
.filter-caret {
  margin-left: 4px;
  opacity: 0.5;
}

/* 5. 搜索历史 */
.recent-search-section { margin-top: 1.5rem; }
.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.clear-history-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: #9ca3af;
}
.history-chips-container {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.history-chip {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px 6px 12px;
  background-color: #e0e7ff;
  border-radius: 999px;
  font-size: 13px;
  color: #3730a3;
  cursor: pointer;
  max-width: 100%;
}
.dark .history-chip { background-color: #312e81; color: #e0e7ff; }
.history-delete-btn {
  background: transparent;
  border: none;
  color: inherit;
  opacity: 0.6;
  margin-left: 4px;
  padding: 2px;
  display: flex;
  cursor: pointer;
}
.history-delete-btn:hover { opacity: 1; }

/* 搜索建议下拉 */
.tag-suggestions {
  position: absolute;
  top: 100%; left: 0; right: 0;
  margin-top: 6px;
  background-color: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 10px 25px rgba(0,0,0,0.1);
  z-index: 100;
  max-height: 240px;
  overflow-y: auto;
}
.dark .tag-suggestions { background-color: #2c2c2e; border-color: #48484a; }
.tag-suggestions ul { list-style: none; margin: 0; padding: 4px; }
.tag-suggestions li {
  padding: 8px 12px;
  cursor: pointer;
  font-size: 14px;
  border-radius: 4px;
}
.tag-suggestions li:hover, .tag-suggestions li.highlighted {
  background-color: #f3f4f6;
}
.dark .tag-suggestions li:hover, .dark .tag-suggestions li.highlighted {
  background-color: #3f3f46;
}

/* 底部弹窗通用 */
.sheet-mask {
  position: fixed; inset: 0; background-color: rgba(0,0,0,0.4);
  display: flex; align-items: flex-end; justify-content: center; z-index: 3000;
  backdrop-filter: blur(2px);
}
.sheet-panel {
  width: 100%; max-width: 640px; max-height: 80vh;
  background-color: #fff;

  /* ✅ 修改 1：四个角都设为圆角 (原来是 16px 16px 0 0) */
  border-radius: 16px;

  /* ✅ 修改 2：增加底部距离，把它“顶”上去 */
  margin-bottom: 12vh;

  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  box-shadow: 0 -4px 20px rgba(0,0,0,0.1);
}
.dark .sheet-panel { background-color: #1f2933; }
.sheet-header {
  display: flex; align-items: center; justify-content: center;
  position: relative; margin-bottom: 1.5rem;
}
.sheet-title { font-size: 16px; font-weight: 600; }
.sheet-close {
  position: absolute; right: 0; top: 50%; transform: translateY(-50%);
  border: none; background: transparent; color: #9ca3af; cursor: pointer; padding: 4px;
}
.sheet-body { flex: 1; overflow-y: auto; padding-bottom: 1rem; }
.sheet-confirm-btn {
  width: 100%; padding: 10px; font-size: 16px; border-radius: 12px;
  border: none; background-color: #6366f1; color: #fff; font-weight: 600;
  margin-top: auto; cursor: pointer;
}
.sheet-confirm-btn:hover { background-color: #4f46e5; }

/* 弹窗内部组件 */
.seg-row { display: flex; gap: 8px; margin-bottom: 16px; }
.seg-btn {
  flex: 1; padding: 6px; font-size: 14px; border-radius: 8px; border: 1px solid #e5e7eb;
  background: #f9fafb; color: #374151; cursor: pointer;
}
.seg-btn.active { background-color: #eff6ff; border-color: #6366f1; color: #6366f1; font-weight: 500; }
.dark .seg-btn { background: #374151; border-color: #4b5563; color: #d1d5db; }
.dark .seg-btn.active { background: #312e81; border-color: #818cf8; color: #818cf8; }

.date-input-row { display: flex; align-items: center; gap: 12px; }
.date-input-wrapper { flex: 1; }
.date-label { font-size: 12px; color: #6b7280; margin-bottom: 4px; display: block; }
.date-input { width: 100%; padding: 6px; border: 1px solid #d1d5db; border-radius: 6px; box-sizing: border-box; }
.dark .date-input { background: #111827; border-color: #4b5563; color: #fff; }

/* ✅ 修改 2: 确保日期分隔符样式正确 */
.date-separator {
  padding-top: 0;
  padding-bottom: 0;
  padding-left: 4px;
  padding-right: 4px;
  align-self: center; /* 明确垂直居中 */
  font-size: 16px;
  color: #9ca3af;
  line-height: 1;

  /* ✅ 新增：给一个固定宽度，并让文字在里面居中 */
  min-width: 24px;
  text-align: center;

  /* 保持你调试好的垂直下移参数 */
  position: relative;
  top: 11px;
}
.tag-mode-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
.tag-mode-btn { padding: 6px; font-size: 14px; border-radius: 8px; border: 1px solid #e5e7eb; background: #fff; cursor: pointer; }
.tag-mode-btn.active { border-color: #6366f1; background-color: #eff6ff; color: #6366f1; }
.dark .tag-mode-btn { background: #374151; border-color: #4b5563; color: #d1d5db; }
.dark .tag-mode-btn.active { background: #312e81; border-color: #818cf8; color: #818cf8; }

.tag-select { width: 100%; padding: 8px; border-radius: 8px; border: 1px solid #d1d5db; background: #fff; font-size: 14px; }
.dark .tag-select { background: #111827; border-color: #4b5563; color: #fff; }

.more-list { list-style: none; margin: 0; padding: 0; }
.more-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 4px; border-bottom: 1px solid #f3f4f6; cursor: pointer; font-size: 15px;
}
.dark .more-item { border-color: #374151; }
.check-icon { color: #6366f1; font-weight: bold; }
</style>
