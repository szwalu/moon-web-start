<script setup lang="ts">
import { computed, ref } from 'vue'

// --- Props and Emits ---
const props = defineProps({
  // 使用 modelValue 接收父组件通过 v-model 传来的 searchQuery
  modelValue: {
    type: String,
    required: true,
  },
  isExporting: {
    type: Boolean,
    default: false,
  },
  allTags: {
    type: Array as () => string[],
    default: () => [],
  },
})

const emit = defineEmits(['update:modelValue', 'exportAll'])

// --- State ---
const searchInputRef = ref<HTMLInputElement | null>(null)
const showSearchTagSuggestions = ref(false)
const searchTagSuggestions = ref<string[]>([])
const highlightedSearchIndex = ref(-1)

// --- v-model Logic ---
// 创建一个计算属性来代理 props.modelValue
// 这样在组件内部就可以用 v-model="searchModel"，同时保持与父组件的状态同步
const searchModel = computed({
  get: () => props.modelValue,
  set: (value) => {
    emit('update:modelValue', value)
    // 当输入框内容变化时，触发标签建议逻辑
    handleSearchQueryChange(value)
  },
})

// --- Tag Suggestion Logic (从 auth.vue 迁移过来) ---
function handleSearchQueryChange(query: string) {
  const lastHashIndex = query.lastIndexOf('#')
  if (lastHashIndex !== -1 && (lastHashIndex === 0 || /\s/.test(query[lastHashIndex - 1]))) {
    const term = query.substring(lastHashIndex + 1)
    const potentialTag = query.substring(lastHashIndex)
    if (!/\s/.test(potentialTag)) {
      searchTagSuggestions.value = props.allTags.filter(tag =>
        tag.toLowerCase().startsWith(`#${term.toLowerCase()}`))
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
  if (showSearchTagSuggestions.value && searchTagSuggestions.value.length > 0)
    highlightedSearchIndex.value = (highlightedSearchIndex.value + offset + searchTagSuggestions.value.length) % searchTagSuggestions.value.length
}

function clearSearch() {
  searchModel.value = ''
  searchInputRef.value?.focus()
}
</script>

<template>
  <div class="search-export-bar">
    <div class="search-input-wrapper">
      <input
        ref="searchInputRef"
        v-model="searchModel"
        type="text"
        placeholder="搜索笔记..."
        class="search-input"
        autocomplete="off"
        @keydown.down.prevent="moveSearchSelection(1)"
        @keydown.up.prevent="moveSearchSelection(-1)"
        @keydown.enter.prevent="selectSearchTag(searchTagSuggestions[highlightedSearchIndex])"
        @keydown.esc="showSearchTagSuggestions = false"
      >
      <button
        v-if="searchModel"
        class="clear-search-button"
        @click="clearSearch"
      >
        ×
      </button>
      <div v-if="showSearchTagSuggestions && searchTagSuggestions.length" class="tag-suggestions search-suggestions">
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
    <button
      class="export-all-button"
      :disabled="isExporting"
      @click="emit('exportAll')"
    >
      {{ isExporting ? '导出中...' : '导出全部' }}
    </button>
  </div>
</template>

<style scoped>
/* 从 auth.vue 中复制过来的相关样式 */
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
  padding: 0.5rem 2rem 0.5rem 0.5rem;
  font-size: 14px;
  border: 1px solid #ccc;
  border-radius: 6px;
  background-color: #fff;
  color: #111;
  min-width: 0;
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

.export-all-button {
  flex: 1;
  padding: 0.5rem 0.75rem;
  margin: 0 !important;
  font-size: 12px !important;
  border-radius: 6px;
  border: 1px solid #bbf7d0 !important;
  cursor: pointer;
  background-color: #f0fdf4 !important;
  color: #16a34a !important;
  white-space: nowrap;
  text-align: center;
  height: 23px;
}

.dark .export-all-button {
  border-color: #22c55e !important;
  background-color: #166534 !important;
  color: #dcfce7 !important;
}

.export-all-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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
</style>
