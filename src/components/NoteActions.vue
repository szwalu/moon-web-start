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

onMounted(() => {
  searchInputRef.value?.focus()
})

// --- 初始化 & 状态 ---
const { t } = useI18n()
const showSearchTagSuggestions = ref(false)
const searchTagSuggestions = ref<string[]>([])
const highlightedSearchIndex = ref(-1)

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
const selectedTagForFilter = ref('') // 选择标签下拉框当前值

// 更多筛选（有图片 / 有链接）
const moreHasImage = ref(false)
const moreHasLink = ref(false)

// 有语音：前端本地 AND 过滤开关
const audioFilterEnabled = ref(false)

// 仅已收藏
const favoriteOnly = ref(false)

// 是否有任何筛选条件生效（用于允许“仅筛选、不输关键字”的搜索）
const hasAnyFilter = computed(() => {
  const hasDate
    = dateMode.value !== 'all'
    || !!startDateStr.value
    || !!endDateStr.value

  const hasTag
    = tagMode.value !== 'all'
    || !!selectedTagForFilter.value

  const hasMore
    = moreHasImage.value || moreHasLink.value || audioFilterEnabled.value || favoriteOnly.value

  return hasDate || hasTag || hasMore
})

// 下拉按钮显示文字
const dateLabel = computed(() => {
  switch (dateMode.value) {
    case 'week':
      return t('notes.search_filter_date_this_week', '本周')
    case 'month':
      return t('notes.search_filter_date_this_month', '本月')
    case 'custom':
      return t('notes.search_filter_date_custom', '自定义')
    default:
      return t('notes.search_filter_date', '日期')
  }
})

const tagLabel = computed(() => {
  switch (tagMode.value) {
    case 'untagged':
      return t('notes.search_filter_tag_untagged', '无标签')
    case 'include':
      return t('notes.search_filter_tag_include', '包含标签')
    case 'exclude':
      return t('notes.search_filter_tag_exclude', '排除标签')
    default:
      return t('notes.search_filter_tag', '标签')
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

// --- v-model Logic ---
const searchModel = computed({
  get: () => props.modelValue,
  set: (value) => {
    emit('update:modelValue', value)
  },
})

// ====== 本地判定工具 ======

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

// “有语音”：稍微放宽，3 项里命中 ≥2 个就算有语音
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

// ====== 自动提示词：只用来填搜索框文案，不参与 RPC 语义 ======
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

// ====== 日期范围 & 标签过滤，用于前端本地过滤 ======
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
      start = new Date(startDateStr.value)
      start.setHours(0, 0, 0, 0)
    }
    if (endDateStr.value) {
      end = new Date(endDateStr.value)
      end.setHours(23, 59, 59, 999)
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

// 标签过滤：基于内容里的 # 文本
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

// 关键字拆 token，全部包含才算命中
function matchKeyword(raw: string, keyword: string): boolean {
  const q = keyword.trim()
  if (!q)
    return true
  const tokens = q.split(/\s+/).filter(Boolean)
  if (!tokens.length)
    return true
  return tokens.every(token => raw.includes(token))
}

// === 统一本地过滤逻辑（关键字 + 日期 + 标签 + 更多） ===
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

      // ✅ 这里改成：只有明确为 false 时才排除，undefined 视为“由后端已过滤”
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

/**
 * 构造 RPC payload：
 * - search_term 只用“真实关键字”，完全不含“有图片 / 有语音 / 有链接 / 已收藏”这些提示词；
 * - “更多”条件通过 payload.has_image / has_link / favorite_only / has_audio 通知后端做一层粗过滤，
 *   前端再用 applyAllFilters 做 AND 精过滤。
 */
function buildSearchPayload(termOverride?: string) {
  const raw = typeof termOverride === 'string' ? termOverride : searchModel.value
  const rawQuery = raw.trim()

  const queryWithoutAuto = isPureAutoLabelQuery(rawQuery)
    ? ''
    : stripAutoLabels(rawQuery)

  const payload: Record<string, any> = {
    p_user_id: props.user.id,
  }

  payload.search_term = queryWithoutAuto || null

  payload.date_mode = dateMode.value
  payload.date_start = startDateStr.value || null
  payload.date_end = endDateStr.value || null

  payload.tag_mode = tagMode.value
  payload.tag_value
    = (tagMode.value === 'include' || tagMode.value === 'exclude')
      ? (selectedTagForFilter.value || null)
      : null

  // 图片 / 链接 / 收藏 / 语音 → 后端先过滤一层
  payload.has_image = moreHasImage.value
  payload.has_link = moreHasLink.value
  payload.favorite_only = favoriteOnly.value
  payload.has_audio = audioFilterEnabled.value

  return { payload, queryBase: queryWithoutAuto }
}

// --- 搜索执行函数（localStorage 缓存 + 前端 AND 过滤） ---
// --- 搜索执行函数（带版本控制的智能缓存） ---
// --- 搜索执行函数（带版本控制的智能缓存 + 状态补全） ---
async function executeSearch(termOverride?: string) {
  if (!props.user?.id)
    return

  const { payload, queryBase } = buildSearchPayload(termOverride)

  // 没关键字、也没任何筛选 → 清空搜索
  if (!queryBase && !hasAnyFilter.value) {
    emit('searchCleared')
    return
  }

  // 1. 获取当前全局数据版本号
  const currentDbVersion = localStorage.getItem('NOTES_DB_VERSION') || '0'

  // 生成缓存 key
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

  // 2. 尝试读取缓存
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

  // 3. 缓存失效或无缓存，走 Supabase RPC
  try {
    let { data, error } = await supabase.rpc('search_notes_with_highlight', payload)
    if (error)
      throw error

    const results = Array.isArray(data) ? data : []

    // ====== [修改开始] 核心修复：补全 收藏/置顶/天气 状态 ======
    // 即使 RPC 函数没有返回 is_favorited，我们在这里手动查一次，保证状态最新
    const idsToCheck = results.map(n => n.id)

    if (idsToCheck.length) {
      const { data: metaRows, error: mErr } = await supabase
        .from('notes')
        .select('id, weather, is_favorited, is_pinned') // 👈 明确查这几个字段
        .in('id', idsToCheck)

      if (!mErr && metaRows?.length) {
        // 建立 ID -> 数据的映射
        const metaMap = new Map(metaRows.map(r => [r.id, r]))

        // 合并数据
        data = results.map((n) => {
          const meta = metaMap.get(n.id)
          return {
            ...n,
            // 逻辑：优先用 RPC 的（如果RPC改好了），否则用新查到的，最后兜底 null/false
            weather: n.weather ?? meta?.weather ?? null,
            is_favorited: n.is_favorited ?? meta?.is_favorited ?? false, // 👈 修复收藏状态
            is_pinned: n.is_pinned ?? meta?.is_pinned ?? false, // 👈 顺便修复置顶状态
          }
        })
      }
    }
    // ====== [修改结束] ======

    const list = Array.isArray(data) ? data : []
    const finalData = applyAllFilters(list, queryBase)

    // 4. 【写入缓存】
    const cachePayload = {
      v: currentDbVersion,
      d: list,
    }
    localStorage.setItem(cacheKey, JSON.stringify(cachePayload))

    emit('searchCompleted', { data: finalData, error: null, fromCache: false })
  }
  catch (err: any) {
    emit('searchCompleted', { data: [], error: err, fromCache: false })
  }
}

// --- 快捷筛选按钮：有图片 / 有录音 / 有链接 / 已收藏 ---
function handleQuickSearch(type: 'image' | 'audio' | 'link' | 'favorite') {
  showSearchTagSuggestions.value = false
  highlightedSearchIndex.value = -1

  // 重置所有筛选
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

  // 填友好文案（仅用于 UI 提示，不参与 RPC 语义）
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

// 日期弹窗确认：更新模式 & 触发搜索
function confirmDateFilter() {
  if (startDateStr.value || endDateStr.value)
    dateMode.value = 'custom'
  else if (dateMode.value === 'custom')
    dateMode.value = 'all'

  showDateModal.value = false
  executeSearch()
}

// 标签弹窗确认：非 include/exclude 时把已选标签清掉 & 触发搜索
function confirmTagFilter() {
  if (tagMode.value !== 'include' && tagMode.value !== 'exclude')
    selectedTagForFilter.value = ''

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

// --- 标签建议逻辑（输入 # 时的自动补全，保留原有逻辑） ---
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

// --- 回车键处理逻辑 ---
function handleEnterKey() {
  if (showSearchTagSuggestions.value && highlightedSearchIndex.value > -1)
    selectSearchTag(searchTagSuggestions.value[highlightedIndex.value])
  else
    executeSearch()
}

// --- 清除搜索 ---
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

// --- 暴露方法给父组件 ---
defineExpose({
  executeSearch,
})
</script>

<template>
  <div class="search-export-bar">
    <!-- 搜索输入框 -->
    <div class="search-input-wrapper">
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

    <!-- 三个下拉筛选：日期 / 标签 / 更多 -->
    <div class="filter-row">
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

    <!-- 快捷搜索标题 -->
    <div
      v-if="!searchModel"
      class="quick-search-title"
    >
      {{ t('notes.search_quick_title', '快捷搜索') }}
    </div>

    <!-- 快捷搜索：有图片 / 有语音 / 有链接 -->
    <div
      v-if="!searchModel"
      class="quick-search-chips"
    >
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

    <!-- ====== 日期筛选弹窗 ====== -->
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
          <button
            class="sheet-close"
            type="button"
            @click="showDateModal = false"
          >
            ×
          </button>
        </div>

        <div class="sheet-body">
          <div class="seg-row">
            <button
              class="seg-btn"
              :class="{ active: dateMode === 'all' }"
              type="button"
              @click="dateMode = 'all'; startDateStr = ''; endDateStr = ''"
            >
              {{ t('notes.search_date_all', '不限时间') }}
            </button>
            <button
              class="seg-btn"
              :class="{ active: dateMode === 'week' }"
              type="button"
              @click="dateMode = 'week'; startDateStr = ''; endDateStr = ''"
            >
              {{ t('notes.search_date_this_week', '本周') }}
            </button>
            <button
              class="seg-btn"
              :class="{ active: dateMode === 'month' }"
              type="button"
              @click="dateMode = 'month'; startDateStr = ''; endDateStr = ''"
            >
              {{ t('notes.search_date_this_month', '本月') }}
            </button>
          </div>

          <div class="date-input-row">
            <div class="date-input-wrapper">
              <span class="date-label">{{ t('notes.search_date_start', '开始日期') }}</span>
              <input
                v-model="startDateStr"
                type="date"
                class="date-input"
              >
            </div>
            <div class="date-separator">—</div>
            <div class="date-input-wrapper">
              <span class="date-label">{{ t('notes.search_date_end', '结束日期') }}</span>
              <input
                v-model="endDateStr"
                type="date"
                class="date-input"
              >
            </div>
          </div>
        </div>

        <button
          class="sheet-confirm-btn"
          type="button"
          @click="confirmDateFilter"
        >
          {{ t('common.confirm', '确定') }}
        </button>
      </div>
    </div>

    <!-- ====== 标签筛选弹窗 ====== -->
    <div
      v-if="showTagModal"
      class="sheet-mask"
      @click.self="showTagModal = false"
    >
      <div class="sheet-panel">
        <div class="sheet-header">
          <div class="sheet-title">
            {{ t('notes.search_tag_title', '标签范围') }}
          </div>
          <button
            class="sheet-close"
            type="button"
            @click="showTagModal = false"
          >
            ×
          </button>
        </div>

        <div class="sheet-body">
          <div class="tag-mode-grid">
            <button
              class="tag-mode-btn"
              :class="{ active: tagMode === 'all' }"
              type="button"
              @click="tagMode = 'all'; selectedTagForFilter = ''"
            >
              {{ t('notes.search_tag_all', '全部内容') }}
            </button>
            <button
              class="tag-mode-btn"
              :class="{ active: tagMode === 'untagged' }"
              type="button"
              @click="tagMode = 'untagged'; selectedTagForFilter = ''"
            >
              {{ t('notes.search_tag_untagged', '无标签') }}
            </button>
            <button
              class="tag-mode-btn"
              :class="{ active: tagMode === 'include' }"
              type="button"
              @click="tagMode = 'include'"
            >
              {{ t('notes.search_tag_include', '包含指定标签') }}
            </button>
            <button
              class="tag-mode-btn"
              :class="{ active: tagMode === 'exclude' }"
              type="button"
              @click="tagMode = 'exclude'"
            >
              {{ t('notes.search_tag_exclude', '排除指定标签') }}
            </button>
          </div>

          <!-- 选择标签：仅在包含/排除模式下出现 -->
          <div
            v-if="tagMode === 'include' || tagMode === 'exclude'"
            class="tag-select-row"
          >
            <div class="tag-select-label">
              {{ t('notes.search_tag_pick_label', '选择标签') }}
            </div>
            <select
              v-model="selectedTagForFilter"
              class="tag-select"
            >
              <option value="">
                {{ t('notes.search_tag_pick_placeholder', '请选择标签') }}
              </option>
              <option
                v-for="tag in props.allTags"
                :key="tag"
                :value="tag"
              >
                {{ tag }}
              </option>
            </select>
          </div>
        </div>

        <button
          class="sheet-confirm-btn"
          type="button"
          @click="confirmTagFilter"
        >
          {{ t('common.confirm', '确定') }}
        </button>
      </div>
    </div>

    <!-- ====== 更多筛选弹窗 ====== -->
    <div
      v-if="showMoreModal"
      class="sheet-mask"
      @click.self="showMoreModal = false"
    >
      <div class="sheet-panel">
        <div class="sheet-header">
          <div class="sheet-title">
            {{ t('notes.search_more_title', '更多条件') }}
          </div>
          <button
            class="sheet-close"
            type="button"
            @click="showMoreModal = false"
          >
            ×
          </button>
        </div>

        <div class="sheet-body">
          <ul class="more-list">
            <!-- 有图片 -->
            <li class="more-item" @click="moreHasImage = !moreHasImage">
              {{ t('notes.search_quick_has_image', '有图片') }}
              <span v-if="moreHasImage" class="check-icon">✓</span>
            </li>

            <!-- 有链接 -->
            <li class="more-item" @click="moreHasLink = !moreHasLink">
              {{ t('notes.search_quick_has_link', '有链接') }}
              <span v-if="moreHasLink" class="check-icon">✓</span>
            </li>

            <!-- 有语音：仅本地 AND 过滤 + 在 search_term 中附加“录音” -->
            <li class="more-item" @click="audioFilterEnabled = !audioFilterEnabled">
              {{ t('notes.search_quick_has_audio', '有语音') }}
              <span v-if="audioFilterEnabled" class="check-icon">✓</span>
            </li>
          </ul>
        </div>

        <button
          class="sheet-confirm-btn"
          type="button"
          @click="confirmMoreFilter"
        >
          {{ t('common.confirm', '确定') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 原样保留样式不变 */
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

.search-input {
  flex: 1;
  padding: 1rem 2rem 1rem 0.5rem;
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

.dark .clear-search-button {
  color: #aaa;
}

.clear-search-button:hover {
  color: #333;
}

.dark .clear-search-button:hover {
  color: #fff;
}

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

.dark .tag-suggestions {
  background-color: #2c2c2e;
  border-color: #48484a;
}

.tag-suggestions ul {
  list-style: none;
  margin: 0;
  padding: 4px 0;
}

.tag-suggestions li {
  padding: 6px 12px;
  cursor: pointer;
  font-size: 14px;
  white-space: nowrap;
}

.tag-suggestions li:hover,
.tag-suggestions li.highlighted {
  background-color: #f0f0f0;
}

.dark .tag-suggestions li:hover,
.dark .tag-suggestions li.highlighted {
  background-color: #404040;
}

.search-suggestions {
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
}

/* 下拉筛选行 */
.filter-row {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.4rem;
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

/* 快捷搜索标题 + 按钮 */
.quick-search-title {
  margin-top: 0.6rem;
  margin-bottom: 0.1rem;
  font-size: 13px;
  color: #6b7280;
}

.dark .quick-search-title {
  color: #d1d5db;
}

/* 快捷筛选按钮样式 */
.quick-search-chips {
  display: flex;
  flex-wrap: wrap;
  column-gap: 0.75rem;
  row-gap: 0.5rem;
}

.quick-chip {
  padding: 0.5rem 1rem;
  font-size: 13px;
  border-radius: 9999px;
  border: none;
  background-color: #e5e7eb;
  color: #111827;
  cursor: pointer;
}

.quick-chip:hover {
  background-color: #d1d5db;
}

.dark .quick-chip {
  background-color: #4b5563;
  color: #e5e7eb;
}

.dark .quick-chip:hover {
  background-color: #6b7280;
}

/* 底部弹窗通用样式 */
.sheet-mask {
  position: fixed;
  inset: 0;
  background-color: rgba(0,0,0,0.3);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 50;
}

/* ★ 让弹窗整体更高一些，并允许内部滚动 */
.sheet-panel {
  width: 100%;
  max-width: 640px;
  max-height: 80vh;
  background-color: #ffffff;
  border-radius: 16px 16px 0 0;
  padding: 1.5rem 1.5rem 1.25rem; /* ⬅️ 内边距更大 */
  margin-bottom: 4vh;
  display: flex;
  flex-direction: column;
}

.dark .sheet-panel {
  background-color: #1f2933;
}

.sheet-header {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  margin-bottom: 1.1rem; /* ⬅️ 标题和内容之间更宽 */
}

.sheet-body {
  flex: 1;
  padding: 1rem 0 1.25rem; /* ⬅️ 上下留白更大 */
  overflow-y: auto;
}

.sheet-title {
  font-size: 16px;
  font-weight: 600;
}

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

/* ★ 主体增加为可滚动区域，并撑满剩余高度 */

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

/* ===== 日期弹窗内部 ===== */

/* ★ 间距稍微加大一点 */
.seg-row {
  display: flex;
  gap: 1rem;             /* ⬅️ 按钮之间更开 */
  margin-bottom: 1.25rem;
}

.seg-btn {
  flex: 1;
  padding: 0.8rem 1rem;  /* ⬅️ 高度明显增加 */
  font-size: 15px;
  border-radius: 9999px;
  border: none;
  background-color: #e5e7eb;
  color: #111827;
}

.seg-btn.active {
  background-color: #2563eb;
  color: #ffffff;
}

.dark .seg-btn {
  background-color: #4b5563;
  color: #e5e7eb;
}

.dark .seg-btn.active {
  background-color: #2563eb;
  color: #ffffff;
}

.date-input-row {
  display: flex;
  align-items: center;
  gap: 1rem;             /* ⬅️ 左右空一点 */
  margin-top: 0.75rem;
}

.date-input-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.date-label {
  font-size: 13px;
  margin-bottom: 0.4rem; /* ⬅️ label 与输入框间距微调 */
  color: #6b7280;
}

.dark .date-label {
  color: #9ca3af;
}

.date-input {
  padding: 0.7rem 0.9rem;/* ⬅️ 输入框高度加大 */
  border-radius: 8px;
  border: 1px solid #d1d5db;
  font-size: 14px;
}

.dark .date-input {
  background-color: #111827;
  border-color: #4b5563;
  color: #e5e7eb;
}

.date-separator {
  font-size: 16px;
  padding-top: 1rem;
}

/* ===== 标签弹窗 ===== */

/* ★ 标签按钮网格拉宽间距 */
.tag-mode-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.tag-mode-btn {
  padding: 0.7rem 0.9rem;
  font-size: 15px;
  border-radius: 12px;
  border: none;
  background-color: #e5e7eb;
  color: #111827;
  text-align: center;
}

.tag-mode-btn.active {
  background-color: #2563eb;
  color: #ffffff;
}

.dark .tag-mode-btn {
  background-color: #4b5563;
  color: #e5e7eb;
}

.dark .tag-mode-btn.active {
  background-color: #2563eb;
  color: #ffffff;
}

/* 标签选择行 */
.tag-select-row {
  margin-top: 1.5rem;    /* ⬅️ 与上方按钮拉开距离 */
  display: flex;
  flex-direction: column;
  gap: 1rem;             /* ⬅️ label 与 select 间距更大 */
}

.tag-select-label {
  font-size: 14px;
  color: #4b5563;
}
.dark .tag-select-label {
  color: #d1d5db;
}

/* ★ 下拉框也稍微增大一点 */
.tag-select {
  width: 100%;
  padding: 0.7rem 0.9rem;/* ⬅️ 下拉框高度加大 */
  font-size: 15px;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  background-color: #fff;
}

.dark .tag-select {
  background-color: #111827;
  color: #f9fafb;
  border-color: #4b5563;
}

/* ===== 更多弹窗 ===== */

.more-list {
  list-style: none;
  margin: 0;
  padding: 0.5rem 0;     /* ⬅️ 上下再多一点 */
}

.more-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;          /* ⬅️ 文本与勾之间更开 */
  padding: 1rem 0.75rem; /* ⬅️ 行高明显增加，左右也更宽 */
  border-bottom: 1px solid #e5e7eb;
  font-size: 15px;
}

.more-item:last-child {
  border-bottom: none;
}

.more-item.selected {
  font-weight: 600;
}

.dark .more-item {
  border-color: #4b5563;
}

@media (max-width: 768px) {
  .search-input {
    font-size: 16px;
  }
}

/* 勾号样式 */
.check-icon {
  color: #22c55e;      /* 绿色 */
  font-weight: 700;
  width: 1.2rem;
  text-align: center;
}

/* 未选时占位对齐 */
.check-placeholder {
  width: 1.2rem;
}

/* Dark mode */
.dark .more-item {
  border-color: #4b5563;
}
</style>
