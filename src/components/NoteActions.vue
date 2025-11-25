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

// ====== 新增：筛选弹窗相关状态 ======
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

// 更多筛选（有图片 / 有链接 / 有语音）
const moreHasImage = ref(false)
const moreHasLink = ref(false)
const moreHasAudio = ref(false)

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
    = moreHasImage.value || moreHasLink.value || moreHasAudio.value

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
  if (moreHasAudio.value)
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

/**
 * 把「关键字 + 各种筛选条件」打包成 RPC 需要的 payload
 * 同时返回标准化后的 query 字符串，用于缓存 key。
 */
function buildSearchPayload(termOverride?: string) {
  const raw = typeof termOverride === 'string' ? termOverride : searchModel.value
  const query = raw.trim()

  const payload: Record<string, any> = {
    p_user_id: props.user.id,
    search_term: query || null,
  }

  // 日期条件：前端全部传给后端，后端自行决定怎么用
  payload.date_mode = dateMode.value
  payload.date_start = startDateStr.value || null
  payload.date_end = endDateStr.value || null

  // 标签条件：模式 + 具体标签
  payload.tag_mode = tagMode.value
  payload.tag_value
    = (tagMode.value === 'include' || tagMode.value === 'exclude')
      ? (selectedTagForFilter.value || null)
      : null

  // 更多条件：布尔值
  payload.has_image = moreHasImage.value
  payload.has_link = moreHasLink.value
  payload.has_audio = moreHasAudio.value

  return { payload, query }
}

// --- 搜索执行函数（localStorage 缓存） ---
// 支持外部传入 termOverride；不传则用当前输入框内容
async function executeSearch(termOverride?: string) {
  if (!props.user?.id) {
    console.error(t('notes.search_error_user_invalid', '搜索中止，原因：用户未登录或用户信息无效'))
    return
  }

  const { payload, query } = buildSearchPayload(termOverride)

  // 既没有关键字，也没有任何筛选 → 视为清空搜索
  if (!query && !hasAnyFilter.value) {
    emit('searchCleared')
    return
  }

  // 缓存 key 需要把「关键字 + 筛选条件」都算进去
  const cacheKey = getSearchCacheKey(JSON.stringify({
    q: query || '',
    dm: dateMode.value,
    ds: startDateStr.value,
    de: endDateStr.value,
    tm: tagMode.value,
    tag: selectedTagForFilter.value,
    img: moreHasImage.value,
    link: moreHasLink.value,
    audio: moreHasAudio.value,
  }))

  // 1) 先查 localStorage 缓存
  const cachedRaw = localStorage.getItem(cacheKey)
  if (cachedRaw) {
    try {
      const data = JSON.parse(cachedRaw)
      emit('searchCompleted', { data, error: null, fromCache: true })
      return
    }
    catch (e) {
      localStorage.removeItem(cacheKey) // 解析失败，删除损坏的缓存
    }
  }

  // 2) 无缓存，走远端
  emit('searchStarted')
  try {
    let { data, error } = await supabase.rpc('search_notes_with_highlight', payload)
    if (error)
      throw error

    const results = Array.isArray(data) ? data : []
    const missingIds = results
      .filter(n => !('weather' in n))
      .map(n => n.id)
      .filter(Boolean)

    if (missingIds.length) {
      const { data: weatherRows, error: wErr } = await supabase
        .from('notes')
        .select('id, weather')
        .in('id', missingIds)

      if (!wErr && weatherRows?.length) {
        const wMap = new Map(weatherRows.map(r => [r.id, r.weather ?? null]))
        data = results.map(n =>
          ('weather' in n) ? n : ({ ...n, weather: wMap.get(n.id) ?? null }),
        )
      }
      else {
        data = results
      }
    }

    if (data)
      localStorage.setItem(cacheKey, JSON.stringify(data))
    emit('searchCompleted', { data, error: null, fromCache: false })
  }
  catch (err: any) {
    console.error(t('notes.search_error_api_failed', '搜索 API 请求失败:'), err)
    emit('searchCompleted', { data: [], error: err, fromCache: false })
  }
}

// --- 快捷筛选按钮：有图片 / 有录音 / 有链接 ---
// 保持原来的“关键字搜索”行为不变
function handleQuickSearch(type: 'image' | 'audio' | 'link') {
  let keyword = ''

  if (type === 'image')
    keyword = 'note-images/'
  else if (type === 'audio')
    keyword = 'note-audios/'
  else if (type === 'link')
    keyword = 'https://'

  if (!keyword)
    return

  // 更新输入框显示
  searchModel.value = keyword
  showSearchTagSuggestions.value = false
  highlightedSearchIndex.value = -1
  searchInputRef.value?.focus()

  // 直接用关键字执行搜索，不等 v-model 回传
  executeSearch(keyword)
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

// “更多”弹窗确认：不再改搜索框内容，直接带着布尔筛选执行搜索
function confirmMoreFilter() {
  showMoreModal.value = false
  executeSearch()
}

// --- 标签建议逻辑（输入 # 时的自动补全，保留原有逻辑） ---
function handleSearchQueryChange(query: string) {
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
    selectSearchTag(searchTagSuggestions.value[highlightedSearchIndex.value])
  else
    executeSearch()
}

// --- 清除搜索 ---
function clearSearch() {
  searchModel.value = ''
  searchInputRef.value?.focus()
  // 清除关键字的同时也重置筛选
  dateMode.value = 'all'
  startDateStr.value = ''
  endDateStr.value = ''
  tagMode.value = 'all'
  selectedTagForFilter.value = ''
  moreHasImage.value = false
  moreHasLink.value = false
  moreHasAudio.value = false

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
        @input="handleSearchQueryChange(searchModel)"
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
    <div class="quick-search-title">
      {{ t('notes.search_quick_title', '快捷搜索') }}
    </div>

    <!-- 快捷搜索：只保留 有图片 / 有语音 / 有链接 -->
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

            <!-- 有语音 -->
            <li class="more-item" @click="moreHasAudio = !moreHasAudio">
              {{ t('notes.search_quick_has_audio', '有语音') }}
              <span v-if="moreHasAudio" class="check-icon">✓</span>
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

.sheet-panel {
  width: 100%;
  max-width: 640px;
  background-color: #ffffff;
  border-radius: 16px 16px 0 0;
  padding: 1rem 1rem 0.75rem;
  margin-bottom: 5vh;
}

.dark .sheet-panel {
  background-color: #1f2933;
}

.sheet-header {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  margin-bottom: 0.75rem;
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

.sheet-body {
  padding-bottom: 0.75rem;
}

.sheet-confirm-btn {
  width: 100%;
  margin-top: 0.25rem;
  margin-bottom: 0.25rem;
  padding: 0.7rem 1rem;
  font-size: 16px;
  border-radius: 9999px;
  border: none;
  background-color: #22c55e;
  color: #ffffff;
  font-weight: 600;
}

/* 日期弹窗内部 */
.seg-row {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.seg-btn {
  flex: 1;
  padding: 0.5rem 0.75rem;
  font-size: 14px;
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
  gap: 0.5rem;
}

.date-input-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.date-label {
  font-size: 12px;
  margin-bottom: 0.25rem;
  color: #6b7280;
}

.dark .date-label {
  color: #9ca3af;
}

.date-input {
  padding: 0.45rem 0.6rem;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  font-size: 13px;
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

/* 标签弹窗 */
.tag-mode-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

.tag-mode-btn {
  padding: 0.6rem 0.75rem;
  font-size: 14px;
  border-radius: 10px;
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
  margin-top: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.tag-select-label {
  font-size: 14px;
  color: #4b5563;
}

.dark .tag-select-label {
  color: #d1d5db;
}

.tag-select {
  width: 100%;
  padding: 0.55rem 0.75rem;
  font-size: 14px;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  background-color: #fff;
}

.dark .tag-select {
  background-color: #111827;
  color: #f9fafb;
  border-color: #4b5563;
}

/* 更多弹窗 */
.more-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.more-item {
  padding: 0.7rem 0.25rem;
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

/* 左侧打勾图标 */
.more-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.7rem 0.25rem;
  border-bottom: 1px solid #e5e7eb;
  font-size: 15px;
}

.more-item:last-child {
  border-bottom: none;
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
