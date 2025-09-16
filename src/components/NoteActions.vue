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

// 移除所有内存缓存（Map）相关的定义和函数

onMounted(() => {
  searchInputRef.value?.focus()
})

// --- 初始化 & 状态 ---
const { t } = useI18n()
const showSearchTagSuggestions = ref(false)
const searchTagSuggestions = ref<string[]>([])
const highlightedSearchIndex = ref(-1)

// --- v-model Logic ---
const searchModel = computed({
  get: () => props.modelValue,
  set: (value) => {
    emit('update:modelValue', value)
  },
})

// --- 搜索执行函数（修改为 localStorage 缓存） ---
async function executeSearch() {
  const raw = searchModel.value
  const query = raw.trim()

  if (!query) {
    emit('searchCleared')
    return
  }

  if (!props.user?.id) {
    console.error('搜索中止，原因：用户未登录或用户信息无效')
    return
  }

  const cacheKey = getSearchCacheKey(query)

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

  // 2) 无缓存，准备走远端，此时才显示加载
  emit('searchStarted')
  try {
    const { data, error } = await supabase.rpc('search_notes_with_highlight', {
      p_user_id: props.user.id,
      search_term: query,
    })

    if (error)
      throw error

    // 写缓存到 localStorage
    if (data)
      localStorage.setItem(cacheKey, JSON.stringify(data))

    emit('searchCompleted', { data, error: null, fromCache: false })
  }
  catch (err: any) {
    console.error('搜索 API 请求失败:', err)
    emit('searchCompleted', { data: [], error: err, fromCache: false })
  }
}

// --- 标签建议逻辑 (在输入时触发) ---
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
  emit('searchCleared')
}

// --- 暴露方法给父组件 ---
defineExpose({
  executeSearch,
})
</script>

<template>
  <div class="search-export-bar">
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
  </div>
</template>

<style scoped>
.search-export-bar {
  display: flex;
  gap: 0.5rem;
  align-items: center;
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
  flex: 4;
  display: flex;
  align-items: center;
}

.search-input {
  flex: 4;
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

@media (max-width: 768px) {
  .export-all-button {
    display: none;
  }
}
</style>
