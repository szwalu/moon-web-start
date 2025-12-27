<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ChevronDown, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/utils/supabaseClient'

const props = defineProps({
  visible: { type: Boolean, default: false },
  initialDate: { type: [Date, String, Number], default: () => new Date() },
  themeColor: { type: String, default: '#6366f1' },
})

const emit = defineEmits(['close'])
const authStore = useAuthStore()
const { t } = useI18n()

// --- 状态定义 ---
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

const chartData = ref<{ label: string; value: number; percent: number }[]>([])

// --- 新增：计算 Y 轴刻度 ---
const yAxisTicks = computed(() => {
  if (chartData.value.length === 0)
    return []

  // 找出当前数据的最大值
  const maxVal = Math.max(...chartData.value.map(d => d.value))

  // 如果全是0，默认刻度
  if (maxVal === 0)
    return ['100', '50', '0']

  // 辅助函数：格式化数字 (1200 -> 1.2k)
  const format = (n: number) => {
    if (n >= 1000)
      return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
    return String(Math.round(n))
  }

  // 返回 [顶部, 中间, 底部]
  return [
    format(maxVal),
    format(maxVal / 2),
    '0',
  ]
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
  if (activeTab.value === 'overview')
    typeKey = 'all'
  else if (activeTab.value === 'yearly')
    typeKey = `y_${y}`
  else typeKey = `m_${y}_${m}`
  return `stats_cache_${userId}_${typeKey}`
}

function processChartData(notes: any[], year: number, month: number) {
  const dataMap = new Map<number, number>()
  let maxVal = 0

  if (activeTab.value === 'monthly') {
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    for (let i = 1; i <= daysInMonth; i++) dataMap.set(i, 0)

    notes.forEach((n) => {
      const d = new Date(n.created_at)
      const day = d.getDate()
      const words = n.content?.length || 0
      dataMap.set(day, (dataMap.get(day) || 0) + words)
    })

    const result = []
    for (let i = 1; i <= daysInMonth; i++) {
      const val = dataMap.get(i) || 0
      if (val > maxVal)
        maxVal = val
      result.push({
        label: i % 5 === 0 || i === 1 ? String(i) : '',
        value: val,
        percent: 0,
      })
    }
    return result.map(item => ({
      ...item,
      percent: maxVal > 0 ? (item.value / maxVal) * 100 : 0,
    }))
  }
  else if (activeTab.value === 'yearly') {
    for (let i = 0; i < 12; i++) dataMap.set(i, 0)

    notes.forEach((n) => {
      const d = new Date(n.created_at)
      const m = d.getMonth()
      const words = n.content?.length || 0
      dataMap.set(m, (dataMap.get(m) || 0) + words)
    })

    const result = []
    for (let i = 0; i < 12; i++) {
      const val = dataMap.get(i) || 0
      if (val > maxVal)
        maxVal = val
      result.push({ label: String(i + 1), value: val, percent: 0 })
    }
    return result.map(item => ({
      ...item,
      percent: maxVal > 0 ? (item.value / maxVal) * 100 : 0,
    }))
  }
  return []
}

async function fetchStats() {
  const user = authStore.user
  if (!user)
    return

  const storageKey = getStorageKey(user.id)

  const cachedJson = localStorage.getItem(storageKey)
  let hasCache = false

  if (cachedJson) {
    try {
      const cached = JSON.parse(cachedJson)
      stats.value = { days: cached.days, notes: cached.notes, words: cached.words }

      if (cached.chartData && Array.isArray(cached.chartData))
        chartData.value = cached.chartData
      else
        chartData.value = []

      hasCache = true
      isLoading.value = false
    }
    catch (e) {
    }
  }

  if (!hasCache) {
    isLoading.value = true
    stats.value = { days: 0, notes: 0, words: 0 }
    chartData.value = []
  }

  try {
    let query = supabase.from('notes').select('content, created_at').eq('user_id', user.id).order('created_at', { ascending: false })
    const year = currentDate.value.getFullYear()
    const month = currentDate.value.getMonth()

    if (activeTab.value === 'monthly') {
      const startDate = new Date(year, month, 1, 0, 0, 0, 0)
      const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999)
      query = query.gte('created_at', startDate.toISOString()).lte('created_at', endDate.toISOString())
    }
    else if (activeTab.value === 'yearly') {
      const startDate = new Date(year, 0, 1, 0, 0, 0, 0)
      const endDate = new Date(year, 12, 0, 23, 59, 59, 999)
      query = query.gte('created_at', startDate.toISOString()).lte('created_at', endDate.toISOString())
    }

    const notes = await fetchAllData(query)
    const count = notes.length
    const chars = notes.reduce((sum, n) => sum + (n.content?.length || 0), 0)
    const uniqueDays = new Set(notes.map(n => toDateKeyStrFromISO(n.created_at))).size

    let newChartData: any[] = []
    if (activeTab.value !== 'overview')
      newChartData = processChartData(notes, year, month)

    stats.value = { days: uniqueDays, notes: count, words: chars }
    if (activeTab.value !== 'overview')
      chartData.value = newChartData

    const dataToCache = {
      days: uniqueDays,
      notes: count,
      words: chars,
      chartData: newChartData,
    }
    localStorage.setItem(storageKey, JSON.stringify(dataToCache))
  }
  catch (e) { console.error('Stats error:', e) }
  finally { isLoading.value = false }
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
  <div
    class="stats-overlay"
    :style="{
      '--st-accent': props.themeColor,
      '--st-bar-fill': props.themeColor,
      '--st-bar-bg': `color-mix(in srgb, ${props.themeColor}, white 80%)`, // 浅色背景条
      '--st-bar-bg-dark': `color-mix(in srgb, ${props.themeColor}, black 60%)`, // 深色模式背景条
    }"
    @click.self="emit('close')"
  >
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
          :class="{ 'no-pointer': activeTab === 'overview' }"
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

        <div class="stats-card summary-card" :class="{ 'loading-state': isLoading }">
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

        <div
          v-if="activeTab !== 'overview'"
          class="stats-card chart-card"
          :class="{ 'loading-state': isLoading }"
        >
          <div class="card-header-row">
            <span class="card-title">{{ t('stats.words1') }}</span>
          </div>

          <div class="chart-content-wrapper">
            <div v-if="chartData.length > 0" class="chart-layout">
              <div class="chart-y-axis">
                <span class="y-tick">{{ yAxisTicks[0] }}</span>
                <span class="y-tick">{{ yAxisTicks[1] }}</span>
                <span class="y-tick">{{ yAxisTicks[2] }}</span>
              </div>
              <div class="chart-bars-container">
                <div class="grid-line line-top" />
                <div class="grid-line line-mid" />
                <div class="grid-line line-bottom" />
                <div class="chart-bars">
                  <div
                    v-for="(bar, index) in chartData"
                    :key="index"
                    class="bar-wrapper"
                    :title="`${bar.value} words`"
                  >
                    <div class="bar-fill" :style="{ height: `${bar.percent}%` }" />
                    <span class="bar-label">{{ bar.label }}</span>
                  </div>
                </div>
              </div>
            </div>

            <div v-else class="chart-placeholder">
              <span v-if="!isLoading" class="placeholder-text">
                No Data
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ===========================================================================
   🎨 主题变量定义
   =========================================================================== */
.stats-overlay {
  --st-bg: #f9f9f9;
  --st-text: #2c2c2c;
  --st-text-sub: #888;
  --st-card-bg: #ffffff;
  --st-divider: #f0f0f0;
  --st-accent: #6366f1;
  --st-icon-hover: rgba(0,0,0,0.05);
  --st-shadow: 0 10px 40px rgba(0,0,0,0.2);
  --st-bar-bg: #e0e7ff;
  --st-bar-fill: #818cf8;
  --st-grid-line: #f0f0f0; /* 辅助线颜色 */
}

@media (prefers-color-scheme: dark) {
  .stats-overlay {
    --st-bg: #1e1e1e;
    --st-text: #e0e0e0;
    --st-text-sub: #a1a1aa;
    --st-card-bg: #2c2c2c;
    --st-divider: #444;
    --st-accent: #818cf8;
    --st-icon-hover: rgba(255,255,255,0.1);
    --st-shadow: 0 10px 40px rgba(0,0,0,0.5);
    --st-bar-bg: var(--st-bar-bg-dark);
    --st-bar-fill: #6366f1;
    --st-grid-line: #3f3f46;
  }
}

:global(.dark) .stats-overlay {
  --st-bg: #1e1e1e;
  --st-text: #e0e0e0;
  --st-text-sub: #a1a1aa;
  --st-card-bg: #2c2c2c;
  --st-divider: #444;
  --st-accent: #818cf8;
  --st-icon-hover: rgba(255,255,255,0.1);
  --st-shadow: 0 10px 40px rgba(0,0,0,0.5);
  --st-bar-bg: var(--st-bar-bg-dark);
  --st-bar-fill: #6366f1;
  --st-grid-line: #3f3f46;
}

/* ===========================================================================
   📐 布局与样式
   =========================================================================== */

.stats-overlay {
  position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
  background-color: rgba(0, 0, 0, 0.4); backdrop-filter: blur(4px);
  z-index: 5000;
  display: flex; align-items: center; justify-content: center;
  animation: fadeIn 0.2s ease-out;
}

.stats-modal-content {
  width: 420px;
  max-width: 90vw;
  height: 540px;
  background-color: var(--st-bg);
  color: var(--st-text);
  box-shadow: var(--st-shadow);
  border-radius: 20px;
  display: flex; flex-direction: column;
  overflow: hidden;
  animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  transition: background-color 0.3s, color 0.3s;
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
.icon-wrapper:hover { background-color: var(--st-icon-hover); }
.icon-close { color: var(--st-text-sub); transition: color 0.2s; }
.icon-wrapper:hover .icon-close { color: var(--st-text); }

.nav-tabs { display: flex; gap: 24px; }
.tab-item {
  font-size: 15px; color: var(--st-text-sub);
  position: relative; padding-bottom: 8px;
  cursor: pointer; font-weight: 500; transition: color 0.2s;
}
.tab-item.active { color: var(--st-accent); font-weight: 600; }
.tab-indicator {
  position: absolute; bottom: 0; left: 50%; transform: translateX(-50%);
  width: 16px; height: 2px;
  background-color: var(--st-accent);
  border-radius: 2px;
}

.content-body {
  padding: 20px 30px;
  display: flex; flex-direction: column;
  flex: 1;
  gap: 16px;
  padding-bottom: 30px;
}

.date-picker-wrapper {
  position: relative; display: inline-flex; align-items: center; gap: 6px;
  margin-bottom: 8px; align-self: flex-start;
  cursor: pointer; transition: opacity 0.2s; flex-shrink: 0;
}
.date-picker-wrapper.no-pointer {
  cursor: default;
  /* 也可以稍微降低一点不透明度来表示不可点，但不用全消失 */
  /* opacity: 1; */
}
.date-text {
  font-size: 20px; font-weight: 600; color: var(--st-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.date-arrow { margin-top: 2px; color: var(--st-text); opacity: 0.8; }
.hidden-trigger-input {
  position: absolute; top: 0; left: 0; width: 100%; height: 100%;
  opacity: 0; z-index: 10; cursor: pointer; font-size: 20px;
}

/* --- 📦 通用卡片样式 --- */
.stats-card {
  background-color: var(--st-card-bg);
  box-shadow: 0 4px 12px rgba(0,0,0,0.03);
  border-radius: 16px;
  transition: opacity 0.2s, background-color 0.3s;
}
.stats-card.loading-state { opacity: 0.6; }

.summary-card {
  padding: 24px 0;
  flex-shrink: 0;
}

.chart-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 20px 24px;
  min-height: 150px;
}

.card-header-row {
  display: flex; align-items: center; margin-bottom: 16px;
}
.card-title {
  font-size: 16px; font-weight: 600; color: var(--st-text);
}

.stat-grid { display: flex; justify-content: space-around; align-items: center; }
.stat-item {
  display: flex; flex-direction: column; align-items: center;
  flex: 1; position: relative;
}
.stat-item:not(:last-child)::after {
  content: ''; position: absolute; right: 0; top: 25%;
  height: 50%; width: 1px; background-color: var(--st-divider);
}
.stat-num {
  font-size: 22px; font-weight: 700; color: var(--st-text);
  margin-bottom: 6px; font-family: ui-monospace, SFMono-Regular, monospace;
}
.stat-label { font-size: 13px; color: var(--st-text-sub); }

/* --- 📊 Chart Layout (Flex Row) --- */
.chart-content-wrapper { flex: 1; width: 100%; position: relative; }

.chart-layout {
  display: flex;
  width: 100%;
  height: 100%;
  gap: 12px; /* Y轴和柱子之间的间距 */
  padding-bottom: 10px; /* 留给X轴标签的空间 */
}

/* 左侧刻度 */
.chart-y-axis {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  text-align: right;
  height: 100%;
  padding-bottom: 2px; /* 对齐底部 */
  min-width: 30px; /* 保证有宽度显示 12k */
}
.y-tick {
  font-size: 11px;
  color: var(--st-text-sub);
  font-family: ui-monospace, SFMono-Regular, monospace;
  line-height: 1;
}

/* 右侧柱状图容器 */
.chart-bars-container {
  flex: 1;
  position: relative; /* 用于定位辅助线 */
  height: 100%;
  display: flex;
  align-items: flex-end;
}

/* 辅助虚线 */
.grid-line {
  position: absolute;
  left: 0; right: 0;
  height: 1px;
  background-color: var(--st-grid-line);
  z-index: 0;
  pointer-events: none;
}
.line-top { top: 0; border-top: 1px dashed var(--st-grid-line); background: none; }
.line-mid { top: 50%; border-top: 1px dashed var(--st-grid-line); background: none; }
.line-bottom { bottom: 0; background-color: var(--st-grid-line); }

.chart-bars {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: flex-end;
  justify-content: space-between;
  gap: 2px;
  z-index: 1; /* 在辅助线之上 */
}

.bar-wrapper {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  position: relative;
}
.bar-fill {
  width: 60%;
  min-width: 4px;
  background-color: var(--st-bar-fill);
  border-radius: 2px 2px 0 0;
  min-height: 2px;
  transition: height 0.4s cubic-bezier(0.17, 0.67, 0.83, 0.67);
  opacity: 0.8;
}
.bar-wrapper:hover .bar-fill { opacity: 1; }
.bar-label {
  position: absolute;
  bottom: -20px;
  font-size: 10px;
  color: var(--st-text-sub);
  width: 20px;
  text-align: center;
}

.chart-placeholder {
  display: flex; justify-content: center; align-items: center;
  height: 100%; width: 100%; opacity: 0.3;
}
.placeholder-text { font-size: 14px; color: var(--st-text-sub); font-weight: 500; }

@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideUp { from { transform: translateY(20px) scale(0.98); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }
</style>
