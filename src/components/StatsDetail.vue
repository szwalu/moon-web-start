<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ChevronDown, X } from 'lucide-vue-next'

import { useI18n } from 'vue-i18n'

// [新增] 引入 i18n
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/utils/supabaseClient'

const props = defineProps({
  visible: { type: Boolean, default: false },
  initialDate: { type: [Date, String, Number], default: () => new Date() },
})

const emit = defineEmits(['close'])
const authStore = useAuthStore()
const { t } = useI18n() // [新增] 使用 i18n

// --- 状态定义 ---
// [修改] 将 Tab 改为英文 Key，方便逻辑判断和国际化映射
const tabs = ['monthly', 'yearly', 'overview']
const activeTab = ref('monthly')

function getValidDate(val: any): Date {
  const d = new Date(val)
  return Number.isNaN(d.getTime()) ? new Date() : d
}

const currentDate = ref(getValidDate(props.initialDate))
const isLoading = ref(false)

const stats = ref({
  days: 0,
  notes: 0,
  words: 0,
})

const yearOptions = computed(() => {
  const start = 1980
  const end = 2080
  const years = []
  for (let y = end; y >= start; y--)
    years.push(y)

  return years
})

// --- 计算属性 ---

const formattedDateText = computed(() => {
  let d = currentDate.value
  if (Number.isNaN(d.getTime()))
    d = new Date()

  const y = d.getFullYear()
  const m = d.getMonth() + 1

  // [修改] 使用 i18n 进行日期格式化
  if (activeTab.value === 'monthly')
    return t('stats.date_format_monthly', { y, m })
  if (activeTab.value === 'yearly')
    return t('stats.date_format_yearly', { y })

  return t('stats.all_time')
})

const monthPickerValue = computed({
  get: () => {
    try {
      const y = currentDate.value.getFullYear()
      const m = String(currentDate.value.getMonth() + 1).padStart(2, '0')
      return `${y}-${m}`
    }
    catch {
      return new Date().toISOString().slice(0, 7)
    }
  },
  set: (val: string) => {
    if (val) {
      const [y, m] = val.split('-')
      currentDate.value = new Date(Number(y), Number(m) - 1, 1)
      fetchStats()
    }
  },
})

const yearPickerValue = computed({
  get: () => currentDate.value.getFullYear(),
  set: (val: number) => {
    const newDate = new Date(currentDate.value)
    newDate.setFullYear(val)
    currentDate.value = newDate
    fetchStats()
  },
})

// --- 核心逻辑 ---

function toDateKeyStrFromISO(iso: string) {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  return `${y}-${m < 10 ? `0${m}` : m}-${day < 10 ? `0${day}` : day}`
}

async function fetchAllData(queryBuilder: any) {
  const PAGE_SIZE = 1000
  let allData: any[] = []
  let page = 0
  let hasMore = true

  while (hasMore) {
    const { data, error } = await queryBuilder
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (error)
      throw error

    if (data && data.length > 0) {
      allData = allData.concat(data)
      if (data.length < PAGE_SIZE)
        hasMore = false
      else page++
    }
    else {
      hasMore = false
    }
  }
  return allData
}

function getStorageKey(userId: string) {
  const y = currentDate.value.getFullYear()
  const m = currentDate.value.getMonth()

  let typeKey = ''
  // [修改] 对应新的英文 activeTab 值
  if (activeTab.value === 'overview')
    typeKey = 'all'
  else if (activeTab.value === 'yearly')
    typeKey = `y_${y}`
  else typeKey = `m_${y}_${m}`

  return `stats_cache_${userId}_${typeKey}`
}

async function fetchStats() {
  const user = authStore.user
  if (!user)
    return

  const storageKey = getStorageKey(user.id)

  const cachedJson = localStorage.getItem(storageKey)
  if (cachedJson) {
    try {
      stats.value = JSON.parse(cachedJson)
      isLoading.value = false
    }
    catch (e) {
      isLoading.value = true
    }
  }
  else {
    isLoading.value = true
    stats.value = { days: 0, notes: 0, words: 0 }
  }

  try {
    let query = supabase
      .from('notes')
      .select('content, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    const year = currentDate.value.getFullYear()
    const month = currentDate.value.getMonth()

    // [修改] 对应新的英文 activeTab 值
    if (activeTab.value === 'monthly') {
      const startDate = new Date(year, month, 1, 0, 0, 0, 0)
      const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999)
      query = query.gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
    }
    else if (activeTab.value === 'yearly') {
      const startDate = new Date(year, 0, 1, 0, 0, 0, 0)
      const endDate = new Date(year, 12, 0, 23, 59, 59, 999)
      query = query.gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
    }

    const notes = await fetchAllData(query)

    const count = notes.length
    const chars = notes.reduce((sum, n) => sum + (n.content?.length || 0), 0)
    const uniqueDays = new Set(notes.map(n => toDateKeyStrFromISO(n.created_at))).size

    const newData = { days: uniqueDays, notes: count, words: chars }

    if (
      newData.days !== stats.value.days
      || newData.notes !== stats.value.notes
      || newData.words !== stats.value.words
    )
      stats.value = newData

    localStorage.setItem(storageKey, JSON.stringify(newData))
  }
  catch (e) {
    console.error('Stats error:', e)
  }
  finally {
    isLoading.value = false
  }
}

function handleTabClick(tab: string) {
  activeTab.value = tab
  fetchStats()
}

onMounted(() => {
  if (Number.isNaN(currentDate.value.getTime()))
    currentDate.value = new Date()
  fetchStats()
})

watch(() => props.visible, (val) => {
  if (val) {
    if (Number.isNaN(currentDate.value.getTime()))
      currentDate.value = new Date()
    fetchStats()
  }
})
</script>

<template>
  <div class="stats-overlay" @click.self="emit('close')">
    <div class="stats-modal-content">
      <div class="nav-header">
        <div class="nav-left" />
        <div class="nav-tabs">
          <div
            v-for="tab in tabs"
            :key="tab"
            class="tab-item"
            :class="{ active: activeTab === tab }"
            @click="handleTabClick(tab)"
          >
            {{ t(`stats.tabs.${tab}`) }}
            <div v-if="activeTab === tab" class="tab-indicator" />
          </div>
        </div>
        <div class="nav-right" @click="emit('close')">
          <div class="icon-wrapper">
            <X :size="24" class="icon-close" />
          </div>
        </div>
      </div>

      <div class="content-body">
        <div
          class="date-picker-wrapper"
          :class="{ disabled: activeTab === 'overview' }"
        >
          <span class="date-text">{{ formattedDateText }}</span>
          <ChevronDown v-if="activeTab !== 'overview'" :size="18" class="date-arrow" />

          <input
            v-if="activeTab === 'monthly'"
            v-model="monthPickerValue"
            type="month"
            class="hidden-trigger-input"
          >

          <select
            v-if="activeTab === 'yearly'"
            v-model="yearPickerValue"
            class="hidden-trigger-input"
          >
            <option v-for="y in yearOptions" :key="y" :value="y">
              {{ y }}{{ t('stats.year_suffix') }}
            </option>
          </select>
        </div>

        <div class="stats-card" :class="{ 'loading-state': isLoading }">
          <div class="stat-grid">
            <div class="stat-item">
              <span class="stat-num">{{ stats.days }}</span>
              <span class="stat-label">{{ t('stats.days') }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-num">{{ stats.notes }}</span>
              <span class="stat-label">{{ t('stats.notes') }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-num">{{ stats.words }}</span>
              <span class="stat-label">{{ t('stats.words') }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 遮罩 */
.stats-overlay {
  position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
  background-color: rgba(0, 0, 0, 0.4); backdrop-filter: blur(4px);
  z-index: 5000;
  display: flex; align-items: center; justify-content: center;
  animation: fadeIn 0.2s ease-out;
}

/* 弹窗核心样式 */
.stats-modal-content {
  width: 420px;
  max-width: 90vw;
  height: auto;
  max-height: 80vh;
  background-color: #f9f9f9;
  border-radius: 20px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  padding-bottom: 20px;
}

.nav-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px 0 20px;
  background-color: transparent; flex-shrink: 0;
}
.nav-left, .nav-right { width: 40px; display: flex; align-items: center; }
.nav-right { justify-content: flex-end; }

.icon-wrapper {
  width: 32px; height: 32px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background-color 0.2s;
}
.icon-wrapper:hover { background-color: rgba(0,0,0,0.05); }
.icon-close { color: #888; transition: color 0.2s; }
.icon-wrapper:hover .icon-close { color: #333; }

/* Tabs */
.nav-tabs { display: flex; gap: 24px; }
.tab-item {
  font-size: 15px; color: #888;
  position: relative; padding-bottom: 8px;
  cursor: pointer; font-weight: 500; transition: color 0.2s;
}
.tab-item.active { color: #6366f1; font-weight: 600; }
.tab-indicator {
  position: absolute; bottom: 0; left: 50%; transform: translateX(-50%);
  width: 16px; height: 2px; background-color: #6366f1; border-radius: 2px;
}

.content-body {
  padding: 20px 30px;
  display: flex; flex-direction: column;
  position: relative;
}

.date-picker-wrapper {
  position: relative;
  display: inline-flex; align-items: center; gap: 6px;
  margin-bottom: 24px; margin-top: 10px;
  align-self: flex-start;
  cursor: pointer;
}
.date-picker-wrapper.disabled { opacity: 0; pointer-events: none; }

.date-text {
  font-size: 20px; font-weight: 600; color: #2c2c2c;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.date-arrow { margin-top: 2px; color: #2c2c2c; opacity: 0.8; }

.hidden-trigger-input {
  position: absolute;
  top: 0; left: 0; width: 100%; height: 100%;
  opacity: 0;
  z-index: 10;
  cursor: pointer;
  font-size: 20px;
}

/* 数据卡片 */
.stats-card {
  background: white; border-radius: 16px;
  padding: 24px 0;
  box-shadow: 0 4px 12px rgba(0,0,0,0.03);
  transition: opacity 0.2s;
}
.stats-card.loading-state { opacity: 0.6; }

.stat-grid { display: flex; justify-content: space-around; align-items: center; }
.stat-item {
  display: flex; flex-direction: column; align-items: center;
  flex: 1; position: relative;
}
.stat-item:not(:last-child)::after {
  content: ''; position: absolute; right: 0; top: 25%;
  height: 50%; width: 1px; background-color: #f0f0f0;
}
.stat-num {
  font-size: 22px; font-weight: 700; color: #1a1a1a;
  margin-bottom: 6px; font-family: ui-monospace, SFMono-Regular, monospace;
}
.stat-label { font-size: 13px; color: #999; }

@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideUp { from { transform: translateY(20px) scale(0.98); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }
</style>
