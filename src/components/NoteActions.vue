<script setup lang="ts">
import { computed, defineExpose, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { supabase } from '@/utils/supabaseClient'
import { getSearchCacheKey } from '@/utils/cacheKeys'

// --- Props and Emits ---
const props = defineProps({
  modelValue: {
    type: String,
    required: true,
  },
  isExporting: {
    type: Boolean,
    default: false,
  },
  showExportButton: {
    type: Boolean,
    default: true,
  },
  allTags: {
    type: Array as () => string[],
    default: () => [],
  },
  searchQuery: {
    type: String,
    default: '',
  },
  user: {
    type: Object as () => { id?: string },
    required: true,
  },
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
const showAdvancedFilters = ref(false) // 控制“日期/标签/更多”栏的显示

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

// ====== 最近搜索历史 (LocalStorage) ======
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
    console.error('Failed to load search history', e)
  }
}

function saveSearchHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(recentSearches.value))
}

function addToHistory(term: string) {
  const cleanTerm = term.trim()
  if (!cleanTerm)
    return

  // 1. 如果已存在，先移除旧的
  const idx = recentSearches.value.indexOf(cleanTerm)
  if (idx > -1)
    recentSearches.value.splice(idx, 1)

  // 2. 插入到头部
  recentSearches.value.unshift(cleanTerm)

  // 3. 限制数量
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

function applyHistorySearch(term: string) {
  searchModel.value = term
  executeSearch()
}

// ====== 辅助函数 & 自动标签逻辑 ======

function getNoteRaw(note: any): string {
  if (!note)
    return ''

  if (typeof note.content === 'string')
    return note.content

  try {
    return JSON.stringify(note)
  }
  catch {
    return ''
  }
}

// 修复：移除 if 后面不必要的大括号，但保持换行
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
  const raw = getNoteRaw(note)
  return raw.includes('note-images/')
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
    let { data, error } = await supabase.rpc('search_notes_with_highlight', payload)
    if (error)
      throw error

    const results = Array.isArray(data) ? data : []
    const idsToCheck = results.map(n => n.id)

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
        data = results.map((n) => {
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

defineExpose({ executeSearch })
</script>

<template>
  <div class="search-export-bar">
    <div class="search-input-wrapper">
      <div class="search-icon-wrapper">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18" height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
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
        @click="clearSearch"
      >
        ×
      </button>
      <div
        v-if="showSearchTagSuggestions && searchTagSuggestions.length"
        class="tag-suggestions search-suggestions"
      >
        <ul>
          <li
            v-for="(tag, index) in searchTagSuggestions"
            :key="tag"
            :class="{ highlighted: index === highlightedSearchIndex }"
            @click="selectSearchTag(tag)"
          >
            {{ tag }}
          </li>
        </ul>
      </div>
    </div>

    <div class="advanced-toggle-row">
      <button
        class="advanced-toggle-btn"
        @click="showAdvancedFilters = !showAdvancedFilters"
      >
        <span>{{ t('notes.search_advanced', '高级搜索') }}</span>
        <span class="toggle-icon">{{ showAdvancedFilters ? '▴' : '▾' }}</span>
      </button>
    </div>

    <div v-show="showAdvancedFilters" class="filter-row">
      <button
        class="filter-chip"
        type="button"
        @click="showDateModal = true"
      >
        <span>{{ dateLabel }}</span>
        <span class="filter-caret">▾</span>
      </button>
      <button
        class="filter-chip"
        type="button"
        @click="showTagModal = true"
      >
        <span>{{ tagLabel }}</span>
        <span class="filter-caret">▾</span>
      </button>
      <button
        class="filter-chip"
        type="button"
        @click="showMoreModal = true"
      >
        <span>{{ moreLabel }}</span>
        <span class="filter-caret">▾</span>
      </button>
    </div>

    <div v-if="!searchModel">
      <div class="quick-search-title">
        {{ t('notes.search_quick_title', '快捷搜索') }}
      </div>

      <div class="quick-search-chips">
        <button
          class="quick-chip"
          type="button"
          @click="handleQuickSearch('image')"
        >
          {{ t('notes.search_quick_has_image', '有图片') }}
        </button>
        <button
          class="quick-chip"
          type="button"
          @click="handleQuickSearch('audio')"
        >
          {{ t('notes.search_quick_has_audio', '有语音') }}
        </button>
        <button
          class="quick-chip"
          type="button"
          @click="handleQuickSearch('link')"
        >
          {{ t('notes.search_quick_has_link', '有链接') }}
        </button>
        <button
          class="quick-chip"
          type="button"
          @click="handleQuickSearch('favorite')"
        >
          {{ t('notes.search_quick_favorited', '已收藏') }}
        </button>
      </div>

      <div v-if="recentSearches.length > 0" class="recent-search-section">
        <div class="section-header">
          <span class="quick-search-title">{{ t('notes.search_history_title', '最近搜索') }}</span>
          <button class="clear-history-btn" :title="t('common.clear', '清空')" @click="clearAllHistory">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14" height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="trash-icon"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
        <div class="quick-search-chips">
          <div
            v-for="item in recentSearches"
            :key="item"
            class="history-chip"
            @click="applyHistorySearch(item)"
          >
            <span>{{ item }}</span>
            <button class="history-delete-btn" @click.stop="removeHistoryItem(item)">×</button>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="showDateModal"
      class="sheet-mask"
      @click.self="showDateModal = false"
    >
      <div class="sheet-panel">
        <div class="sheet-header">
          <div class="sheet-title">
            {{ t('notes.search_date_title', '日期范围') }}
          </div>
          <button class="sheet-close" type="button" @click="showDateModal = false">×</button>
        </div>
        <div class="sheet-body">
          <div class="seg-row">
            <button class="seg-btn" :class="{ active: dateMode === 'all' }" type="button" @click="dateMode = 'all'; startDateStr = ''; endDateStr = ''">{{ t('notes.search_date_all', '不限时间') }}</button>
            <button class="seg-btn" :class="{ active: dateMode === 'week' }" type="button" @click="dateMode = 'week'; startDateStr = ''; endDateStr = ''">{{ t('notes.search_date_this_week', '本周') }}</button>
            <button class="seg-btn" :class="{ active: dateMode === 'month' }" type="button" @click="dateMode = 'month'; startDateStr = ''; endDateStr = ''">{{ t('notes.search_date_this_month', '本月') }}</button>
          </div>
          <div class="date-input-row">
            <div class="date-input-wrapper">
              <span class="date-label">{{ t('notes.search_date_start', '开始日期') }}</span>
              <input v-model="startDateStr" type="date" class="date-input">
            </div>
            <div class="date-separator">—</div>
            <div class="date-input-wrapper">
              <span class="date-label">{{ t('notes.search_date_end', '结束日期') }}</span>
              <input v-model="endDateStr" type="date" class="date-input">
            </div>
          </div>
        </div>
        <button class="sheet-confirm-btn" type="button" @click="confirmDateFilter">{{ t('common.confirm', '确定') }}</button>
      </div>
    </div>

    <div
      v-if="showTagModal"
      class="sheet-mask"
      @click.self="showTagModal = false"
    >
      <div class="sheet-panel">
        <div class="sheet-header">
          <div class="sheet-title">{{ t('notes.search_tag_title', '标签范围') }}</div>
          <button class="sheet-close" type="button" @click="showTagModal = false">×</button>
        </div>
        <div class="sheet-body">
          <div class="tag-mode-grid">
            <button class="tag-mode-btn" :class="{ active: tagMode === 'all' }" type="button" @click="tagMode = 'all'; selectedTagForFilter = ''">{{ t('notes.search_tag_all', '全部内容') }}</button>
            <button class="tag-mode-btn" :class="{ active: tagMode === 'untagged' }" type="button" @click="tagMode = 'untagged'; selectedTagForFilter = ''">{{ t('notes.search_tag_untagged', '无标签') }}</button>
            <button class="tag-mode-btn" :class="{ active: tagMode === 'include' }" type="button" @click="tagMode = 'include'">{{ t('notes.search_tag_include', '包含指定标签') }}</button>
            <button class="tag-mode-btn" :class="{ active: tagMode === 'exclude' }" type="button" @click="tagMode = 'exclude'">{{ t('notes.search_tag_exclude', '排除指定标签') }}</button>
          </div>
          <div v-if="tagMode === 'include' || tagMode === 'exclude'" class="tag-select-row">
            <div class="tag-select-label">{{ t('notes.search_tag_pick_label', '选择标签') }}</div>
            <select v-model="selectedTagForFilter" class="tag-select">
              <option value="">{{ t('notes.search_tag_pick_placeholder', '请选择标签') }}</option>
              <option v-for="tag in props.allTags" :key="tag" :value="tag">{{ tag }}</option>
            </select>
          </div>
        </div>
        <button class="sheet-confirm-btn" type="button" @click="confirmTagFilter">{{ t('common.confirm', '确定') }}</button>
      </div>
    </div>

    <div
      v-if="showMoreModal"
      class="sheet-mask"
      @click.self="showMoreModal = false"
    >
      <div class="sheet-panel">
        <div class="sheet-header">
          <div class="sheet-title">{{ t('notes.search_more_title', '更多条件') }}</div>
          <button class="sheet-close" type="button" @click="showMoreModal = false">×</button>
        </div>
        <div class="sheet-body">
          <ul class="more-list">
            <li class="more-item" @click="moreHasImage = !moreHasImage">{{ t('notes.search_quick_has_image', '有图片') }}<span v-if="moreHasImage" class="check-icon">✓</span></li>
            <li class="more-item" @click="moreHasLink = !moreHasLink">{{ t('notes.search_quick_has_link', '有链接') }}<span v-if="moreHasLink" class="check-icon">✓</span></li>
            <li class="more-item" @click="audioFilterEnabled = !audioFilterEnabled">{{ t('notes.search_quick_has_audio', '有语音') }}<span v-if="audioFilterEnabled" class="check-icon">✓</span></li>
          </ul>
        </div>
        <button class="sheet-confirm-btn" type="button" @click="confirmMoreFilter">{{ t('common.confirm', '确定') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 保持原有基础样式 */
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

.dark .search-export-bar {
  background-color: #374151;
}

.search-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

/* === 放大镜图标容器 === */
.search-icon-wrapper {
  position: absolute;
  left: 1rem; /* 稍微往右挪一点点，视觉更平衡 */
  top: 50%;
  transform: translateY(-50%);
  color: #9ca3af;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dark .search-icon-wrapper {
  color: #6b7280;
}

.search-input {
  flex: 1;
  /* ★ 修改这里：左边距加大到 3.2rem，避开图标 */
  padding: 1rem 2rem 1rem 6.2rem;
  font-size: 14px;
  border: 1px solid #ccc;
  border-radius: 6px;
  background-color: #fff;
  color: #111;
  min-width: 0;
}

@media (max-width: 768px) {
  .search-input {
    font-size: 16px;
  }
}

.dark .search-input {
  background-color: #2c2c2e;
  border-color: #48484a;
  color: #ffffff;
}

.search-input:focus {
  border-color: #00b386;
  outline: none;
}

.clear-search-button {
  position: absolute;
  right: 0.5rem;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  color: #999;
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
  padding: 0;
  margin: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* === 高级搜索开关 === */
.advanced-toggle-row {
  display: flex;
  justify-content: flex-start;
  margin-top: -0.2rem;
  margin-bottom: 0.2rem;
}

.advanced-toggle-btn {
  background: transparent;
  border: none;
  color: #6b7280;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  padding: 4px 0;
}

.dark .advanced-toggle-btn { color: #9ca3af; }
.advanced-toggle-btn:hover { color: #374151; }
.dark .advanced-toggle-btn:hover { color: #d1d5db; }
.toggle-icon { font-size: 10px; }

/* === 下拉筛选行 === */
.filter-row {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.2rem;
  animation: fadeIn 0.2s ease-in-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-5px); }
  to { opacity: 1; transform: translateY(0); }
}

.filter-chip {
  flex: 1;
  padding: 0.5rem 0.75rem;
  font-size: 14px;
  border-radius: 9999px;
  border: none;
  background-color: #ffffff;
  color: #111827;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}

.dark .filter-chip {
  background-color: #4b5563;
  color: #f9fafb;
}

.filter-caret {
  font-size: 10px;
  margin-left: 0.25rem;
}

/* === 标题通用样式 === */
.quick-search-title {
  margin-top: 0.6rem;
  margin-bottom: 0.1rem;
  font-size: 13px;
  color: #6b7280;
}

.dark .quick-search-title {
  color: #d1d5db;
}

/* === 快捷搜索 Chips === */
.quick-search-chips {
  display: flex;
  flex-wrap: wrap;
  column-gap: 3.0rem;
  row-gap: 0.6rem;
  margin-top: 0.4rem;
}

.quick-chip {
  padding: 0.5rem 1.0rem;
  font-size: 13px;
  border-radius: 9999px;
  border: none;
  background-color: #e5e7eb;
  color: #111827;
  cursor: pointer;
}
.quick-chip:hover { background-color: #d1d5db; }
.dark .quick-chip { background-color: #4b5563; color: #e5e7eb; }
.dark .quick-chip:hover { background-color: #6b7280; }

/* === 最近搜索区域 === */
.recent-search-section {
  margin-top: 1rem;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.1rem;
}

.clear-history-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6b7280;
}

.clear-history-btn:hover {
  color: #374151;
}

.dark .clear-history-btn {
  color: #9ca3af;
}

.dark .clear-history-btn:hover {
  color: #d1d5db;
}

.trash-icon {
  display: block;
}

/* History Chip */
.history-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.4rem 0.7rem 0.4rem 1.0rem;
  gap: 0.5rem;
  background-color: #e0e7ff;
  border-radius: 9999px;
  font-size: 13px;
  cursor: pointer;
  color: #3730a3;
  max-width: 100%;
}

.dark .history-chip {
  background-color: #312e81;
  color: #e0e7ff;
}

.history-chip:hover {
  filter: brightness(0.95);
}

.history-delete-btn {
  background: transparent;
  border: none;
  color: #6366f1;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.history-delete-btn:hover {
  background-color: rgba(0,0,0,0.1);
}

.dark .history-delete-btn {
  color: #818cf8;
}

.dark .history-delete-btn:hover {
  background-color: rgba(255,255,255,0.2);
}

/* === 自动提示下拉 === */
.tag-suggestions {
  position: absolute;
  background-color: white;
  border: 1px solid #ccc;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: 1000;
  max-height: 200px;
  overflow-y: auto;
  min-width: 150px;
}
.dark .tag-suggestions { background-color: #2c2c2e; border-color: #48484a; }
.tag-suggestions ul { list-style: none; margin: 0; padding: 4px 0; }
.tag-suggestions li { padding: 6px 12px; cursor: pointer; font-size: 14px; white-space: nowrap; }
.tag-suggestions li:hover, .tag-suggestions li.highlighted { background-color: #f0f0f0; }
.dark .tag-suggestions li:hover, .dark .tag-suggestions li.highlighted { background-color: #404040; }
.search-suggestions { top: 100%; left: 0; right: 0; margin-top: 4px; }

/* === 底部弹窗通用样式 === */
.sheet-mask {
  position: fixed;
  inset: 0;
  background-color: rgba(0,0,0,0.3);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 50;
}
.sheet-panel {
  width: 100%;
  max-width: 640px;
  max-height: 80vh;
  background-color: #ffffff;
  border-radius: 16px 16px 0 0;
  padding: 1.5rem 1.5rem 1.25rem;
  margin-bottom: 4vh;
  display: flex;
  flex-direction: column;
}
.dark .sheet-panel { background-color: #1f2933; }
.sheet-header {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  margin-bottom: 1.1rem;
}
.sheet-body { flex: 1; padding: 1rem 0 1.25rem; overflow-y: auto; }
.sheet-title { font-size: 16px; font-weight: 600; }
.sheet-close {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  border: none;
  background: transparent;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.sheet-confirm-btn {
  width: 100%;
  margin-top: 0.5rem;
  margin-bottom: 0.25rem;
  padding: 0.8rem 1rem;
  font-size: 16px;
  border-radius: 9999px;
  border: none;
  background-color: #22c55e;
  color: #ffffff;
  font-weight: 600;
}

/* 弹窗内部样式 */
.seg-row { display: flex; gap: 1rem; margin-bottom: 1.25rem; }
.seg-btn {
  flex: 1; padding: 0.8rem 1rem; font-size: 15px; border-radius: 9999px; border: none; background-color: #e5e7eb; color: #111827;
}
.seg-btn.active { background-color: #2563eb; color: #ffffff; }
.dark .seg-btn { background-color: #4b5563; color: #e5e7eb; }
.dark .seg-btn.active { background-color: #2563eb; color: #ffffff; }

.date-input-row { display: flex; align-items: center; gap: 1rem; margin-top: 0.75rem; }
.date-input-wrapper { flex: 1; display: flex; flex-direction: column; }
.date-label { font-size: 13px; margin-bottom: 0.4rem; color: #6b7280; }
.dark .date-label { color: #9ca3af; }
.date-input { padding: 0.7rem 0.9rem; border-radius: 8px; border: 1px solid #d1d5db; font-size: 14px; }
.dark .date-input { background-color: #111827; border-color: #4b5563; color: #e5e7eb; }
.date-separator { font-size: 16px; padding-top: 1rem; }

.tag-mode-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem; margin-bottom: 0.75rem; }
.tag-mode-btn { padding: 0.7rem 0.9rem; font-size: 15px; border-radius: 12px; border: none; background-color: #e5e7eb; color: #111827; text-align: center; }
.tag-mode-btn.active { background-color: #2563eb; color: #ffffff; }
.dark .tag-mode-btn { background-color: #4b5563; color: #e5e7eb; }
.dark .tag-mode-btn.active { background-color: #2563eb; color: #ffffff; }

.tag-select-row { margin-top: 1.5rem; display: flex; flex-direction: column; gap: 1rem; }
.tag-select-label { font-size: 14px; color: #4b5563; }
.dark .tag-select-label { color: #d1d5db; }
.tag-select { width: 100%; padding: 0.7rem 0.9rem; font-size: 15px; border-radius: 8px; border: 1px solid #d1d5db; background-color: #fff; }
.dark .tag-select { background-color: #111827; color: #f9fafb; border-color: #4b5563; }

.more-list { list-style: none; margin: 0; padding: 0.5rem 0; }
.more-item { display: flex; align-items: center; gap: 0.75rem; padding: 1rem 0.75rem; border-bottom: 1px solid #e5e7eb; font-size: 15px; }
.more-item:last-child { border-bottom: none; }
.dark .more-item { border-color: #4b5563; }
.check-icon { color: #22c55e; font-weight: 700; width: 1.2rem; text-align: center; }
</style>
