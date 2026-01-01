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
const chartMode = ref<'words' | 'notes'>('words')

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
  locations: 0,
  images: 0,
  audios: 0,
})

const wordChartData = ref<{ label: string; value: number; percent: number }[]>([])
const noteChartData = ref<{ label: string; value: number; percent: number }[]>([])

const currentChartData = computed(() => {
  return chartMode.value === 'words' ? wordChartData.value : noteChartData.value
})

function calculateYAxisTicks(data: { value: number }[]) {
  if (data.length === 0)
    return ['10', '5', '0']
  const maxVal = Math.max(...data.map(d => d.value))

  if (maxVal === 0)
    return ['4', '2', '0']

  let top = maxVal
  if (maxVal <= 5)
    top = maxVal
  else
    top = Math.ceil(maxVal * 1.1)

  const format = (n: number) => {
    if (n >= 1000)
      return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
    return String(Math.floor(n))
  }

  return [format(top), format(top / 2), '0']
}

const currentAxisTicks = computed(() => calculateYAxisTicks(currentChartData.value))

const yearOptions = computed(() => {
  const start = 1980
  const end = 2080
  const years = []
  for (let y = end; y >= start; y--) years.push(y)
  return years
})

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
    catch { return new Date().toISOString().slice(0, 7) }
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

function getNoteRaw(note: any): string {
  if (!note)
    return ''
  let text = ''
  if (typeof note.content === 'string')
    text += note.content
  if (typeof note.weather === 'string')
    text += ` ${note.weather}`
  return text
}

function checkHasImage(note: any): boolean {
  return getNoteRaw(note).includes('note-images/')
}

function checkHasAudio(note: any): boolean {
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
    const { data, error } = await queryBuilder.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (error)
      throw error
    if (data && data.length > 0) {
      allData = allData.concat(data)
      if (data.length < PAGE_SIZE)
        hasMore = false
      else page++
    }
    else { hasMore = false }
  }
  return allData
}

function getStorageKey(userId: string) {
  const y = currentDate.value.getFullYear()
  const m = currentDate.value.getMonth()
  const typeKey = activeTab.value === 'overview' ? 'all' : (activeTab.value === 'yearly' ? `y_${y}` : `m_${y}_${m}`)
  return `stats_cache_v16_${userId}_${typeKey}`
}

function processChartData(notes: any[], year: number, month: number) {
  const wordsMap = new Map<number, number>()
  const notesMap = new Map<number, number>()
  let maxWords = 0
  let maxNotes = 0

  if (activeTab.value === 'monthly') {
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    for (let i = 1; i <= daysInMonth; i++) {
      wordsMap.set(i, 0)
      notesMap.set(i, 0)
    }

    notes.forEach((n) => {
      const d = new Date(n.created_at)
      if (d.getMonth() === month && d.getFullYear() === year) {
        const day = d.getDate()
        wordsMap.set(day, (wordsMap.get(day) || 0) + (n.content?.length || 0))
        notesMap.set(day, (notesMap.get(day) || 0) + 1)
      }
    })

    const wordRes = []
    const noteRes = []
    for (let i = 1; i <= daysInMonth; i++) {
      const wVal = wordsMap.get(i) || 0
      const nVal = notesMap.get(i) || 0
      if (wVal > maxWords)
        maxWords = wVal
      if (nVal > maxNotes)
        maxNotes = nVal
      const label = i % 5 === 0 || i === 1 ? String(i) : ''
      wordRes.push({ label, value: wVal, percent: 0 })
      noteRes.push({ label, value: nVal, percent: 0 })
    }

    return {
      wordChart: wordRes.map(item => ({ ...item, percent: maxWords > 0 ? (item.value / maxWords) * 100 : 0 })),
      noteChart: noteRes.map(item => ({ ...item, percent: maxNotes > 0 ? (item.value / maxNotes) * 100 : 0 })),
    }
  }
  else if (activeTab.value === 'yearly') {
    for (let i = 0; i < 12; i++) {
      wordsMap.set(i, 0)
      notesMap.set(i, 0)
    }
    notes.forEach((n) => {
      const d = new Date(n.created_at)
      if (d.getFullYear() === year) {
        const m = d.getMonth()
        wordsMap.set(m, (wordsMap.get(m) || 0) + (n.content?.length || 0))
        notesMap.set(m, (notesMap.get(m) || 0) + 1)
      }
    })
    const wordRes = []
    const noteRes = []
    for (let i = 0; i < 12; i++) {
      const wVal = wordsMap.get(i) || 0
      const nVal = notesMap.get(i) || 0
      if (wVal > maxWords)
        maxWords = wVal
      if (nVal > maxNotes)
        maxNotes = nVal
      const label = String(i + 1)
      wordRes.push({ label, value: wVal, percent: 0 })
      noteRes.push({ label, value: nVal, percent: 0 })
    }
    return {
      wordChart: wordRes.map(item => ({ ...item, percent: maxWords > 0 ? (item.value / maxWords) * 100 : 0 })),
      noteChart: noteRes.map(item => ({ ...item, percent: maxNotes > 0 ? (item.value / maxNotes) * 100 : 0 })),
    }
  }
  return { wordChart: [], noteChart: [] }
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
      stats.value = {
        days: cached.days,
        notes: cached.notes,
        words: cached.words,
        locations: cached.locations || 0,
        images: cached.images || 0,
        audios: cached.audios || 0,
      }
      wordChartData.value = cached.wordChart || []
      noteChartData.value = cached.noteChart || []
      hasCache = true
      isLoading.value = false
    }
    catch (e) {}
  }

  if (!hasCache) {
    isLoading.value = true
    stats.value = { days: 0, notes: 0, words: 0, locations: 0, images: 0, audios: 0 }
    wordChartData.value = []
    noteChartData.value = []
  }

  try {
    let query = supabase
      .from('notes')
      .select('id, content, created_at, weather')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

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

    const rawNotes = await fetchAllData(query)

    const uniqueMap = new Map()
    rawNotes.forEach((n: any) => {
      if (n.id)
        uniqueMap.set(n.id, n)
    })
    let notes = Array.from(uniqueMap.values())

    notes = notes.filter((n: any) => n.content && n.content.trim().length > 0)

    if (notes.length > 1) {
      notes.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      const deduped: any[] = []
      for (let i = 0; i < notes.length; i++) {
        const curr = notes[i]
        const next = notes[i + 1]
        if (next && curr.content === next.content) {
          const timeDiff = Math.abs(new Date(next.created_at).getTime() - new Date(curr.created_at).getTime())
          if (timeDiff < 2000)
            continue
        }
        deduped.push(curr)
      }
      notes = deduped
    }

    const count = notes.length
    const uniqueDays = new Set(notes.map(n => toDateKeyStrFromISO(n.created_at))).size

    let totalChars = 0
    let imgNotesCount = 0
    let audioNotesCount = 0
    const uniqueLocs = new Set<string>()

    notes.forEach((n) => {
      totalChars += (n.content || '').length

      if (checkHasImage(n))
        imgNotesCount++
      if (checkHasAudio(n))
        audioNotesCount++

      if (n.weather && typeof n.weather === 'string') {
        const parts = n.weather.trim().split(' ')
        if (parts.length > 0 && parts[0])
          uniqueLocs.add(parts[0])
      }
    })

    let charts = { wordChart: [], noteChart: [] }
    if (activeTab.value !== 'overview') {
      // @ts-expect-error: inferred type mismatch
      charts = processChartData(notes, year, month)
    }

    stats.value = {
      days: uniqueDays,
      notes: count,
      words: totalChars,
      locations: uniqueLocs.size,
      images: imgNotesCount,
      audios: audioNotesCount,
    }

    if (activeTab.value !== 'overview') {
      wordChartData.value = charts.wordChart
      noteChartData.value = charts.noteChart
    }

    const dataToCache = {
      days: uniqueDays,
      notes: count,
      words: totalChars,
      locations: uniqueLocs.size,
      images: imgNotesCount,
      audios: audioNotesCount,
      wordChart: charts.wordChart,
      noteChart: charts.noteChart,
    }
    localStorage.setItem(storageKey, JSON.stringify(dataToCache))
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
  <div
    class="stats-overlay"
    :style="{
      '--st-accent': props.themeColor,
      '--st-bar-fill': props.themeColor,
      '--st-bar-bg': `color-mix(in srgb, ${props.themeColor}, white 80%)`,
      '--st-bar-bg-dark': `color-mix(in srgb, ${props.themeColor}, black 60%)`,
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
          <div class="stat-rows-container">
            <div class="stat-row">
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

            <div class="stat-row">
              <div class="stat-item">
                <span class="stat-num">{{ stats.locations }}</span>
                <span class="stat-label">{{ t('stats.locations') || '地点' }}</span>
              </div>
              <div class="stat-item">
                <span class="stat-num">{{ stats.images }}</span>
                <span class="stat-label">图片</span>
              </div>
              <div class="stat-item">
                <span class="stat-num">{{ stats.audios }}</span>
                <span class="stat-label">音频</span>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="activeTab !== 'overview'"
          class="stats-card chart-card"
          :class="{ 'loading-state': isLoading }"
        >
          <div class="card-header-row">
            <span class="card-title">
              {{ chartMode === 'words' ? t('stats.words_trend') : t('stats.notes_trend') }}
            </span>

            <div class="chart-switch-container">
              <div
                class="switch-pill"
                :class="{ active: chartMode === 'words' }"
                @click="chartMode = 'words'"
              >
                {{ t('stats.words_short') }}
              </div>
              <div
                class="switch-pill"
                :class="{ active: chartMode === 'notes' }"
                @click="chartMode = 'notes'"
              >
                {{ t('stats.notes_short') }}
              </div>
            </div>
          </div>

          <div class="chart-content-wrapper fixed-height">
            <div v-if="currentChartData.length > 0" class="chart-layout">
              <div class="chart-y-axis">
                <span class="y-tick">{{ currentAxisTicks[0] }}</span>
                <span class="y-tick">{{ currentAxisTicks[1] }}</span>
                <span class="y-tick">{{ currentAxisTicks[2] }}</span>
              </div>
              <div class="chart-bars-container">
                <div class="grid-line line-top" />
                <div class="grid-line line-mid" />
                <div class="grid-line line-bottom" />
                <div class="chart-bars">
                  <div
                    v-for="(bar, index) in currentChartData"
                    :key="index"
                    class="bar-wrapper"
                    :title="`${bar.value}`"
                  >
                    <div
                      class="bar-fill"
                      :style="{
                        height: `${bar.percent}%`,
                        backgroundColor: chartMode === 'words' ? 'var(--st-bar-fill)' : 'var(--st-bar-fill-notes)',
                      }"
                    />
                    <span class="bar-label">{{ bar.label }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="chart-placeholder">
              <span v-if="!isLoading" class="placeholder-text">No Data</span>
            </div>
          </div>
        </div>

        <div
          v-else
          class="stats-card chart-card-placeholder"
        />
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
  --st-bar-fill-notes: #34d399;

  --st-grid-line: #f0f0f0;
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
    --st-bar-fill-notes: #34d399;
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
  --st-bar-fill-notes: #34d399;
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
  width: 440px;
  max-width: 90vw;
  height: auto;
  max-height: 85vh;
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
  /* 🔥 修改 1: 减少内容区域的间距，让总表和日期更近 */
  gap: 10px;
  padding-bottom: 30px;
  overflow-y: auto;
  scrollbar-width: thin;
}
.content-body::-webkit-scrollbar { width: 4px; }
.content-body::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 2px; }

.date-picker-wrapper {
  position: relative; display: inline-flex; align-items: center; gap: 6px;
  /* 🔥 修改 2: 减少日期选择器的下边距 */
  margin-bottom: 4px;
  align-self: flex-start;
  cursor: pointer; transition: opacity 0.2s; flex-shrink: 0;
}
.date-picker-wrapper.no-pointer { cursor: default; }
.date-text {
  font-size: 20px; font-weight: 600; color: var(--st-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.date-arrow { margin-top: 2px; color: var(--st-text); opacity: 0.8; }
.hidden-trigger-input {
  position: absolute; top: 0; left: 0; width: 100%; height: 100%;
  opacity: 0; z-index: 10; cursor: pointer; font-size: 20px;
}

.stats-card {
  background-color: var(--st-card-bg);
  box-shadow: 0 4px 12px rgba(0,0,0,0.03);
  border-radius: 16px;
  transition: opacity 0.2s, background-color 0.3s;
}
.stats-card.loading-state { opacity: 0.6; }

/* 🔥 修改 3: 进一步减小总表的高度 (内边距) */
.summary-card {
  padding: 9px 0;
  flex-shrink: 0;
}

.stat-rows-container {
  display: flex; flex-direction: column;
  /* 🔥 修改 4: 减小两行之间的间距 */
  gap: 9px;
}

.stat-row {
  display: flex; justify-content: space-around; align-items: center;
}

.stat-item {
  display: flex; flex-direction: column; align-items: center;
  flex: 1; position: relative;
}

.stat-num {
  font-size: 18px;
  font-weight: 700; color: var(--st-text);
  /* 🔥 修改 5: 减小数字和文字之间的间距 */
  margin-bottom: 2px;
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.stat-label {
  font-size: 12px;
  color: var(--st-text-sub);
}

.card-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.card-title { font-size: 16px; font-weight: 600; color: var(--st-text); }

.chart-switch-container {
  display: flex;
  background-color: rgba(0,0,0,0.06);
  border-radius: 8px;
  padding: 3px;
  gap: 2px;
}
.switch-pill {
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  border-radius: 6px;
  color: var(--st-text-sub);
  transition: all 0.2s cubic-bezier(0.25, 0.8, 0.5, 1);
  font-weight: 500;
  user-select: none;
}
.switch-pill.active {
  background-color: #fff;
  color: var(--st-text);
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  font-weight: 600;
}
.dark .switch-pill.active {
  background-color: #444;
  color: #fff;
}

.chart-card {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 20px 24px;
}

/* 🔥 空白占位卡片：保持与有图表时相同的高度 */
/* header 40 + content 130 + padding 40 = 210 */
.chart-card-placeholder {
  min-height: 210px;
}

/* 🔥 修复：固定高度改为 130px */
.chart-content-wrapper.fixed-height {
  height: 130px;
  width: 100%;
  position: relative;
  flex: none;
}

.chart-layout {
  display: flex; width: 100%; height: 100%;
  gap: 12px; padding-bottom: 10px;
}

.chart-y-axis {
  display: flex; flex-direction: column; justify-content: space-between;
  text-align: right; height: 100%; padding-bottom: 2px; min-width: 30px;
}
.y-tick {
  font-size: 11px; color: var(--st-text-sub);
  font-family: ui-monospace, SFMono-Regular, monospace; line-height: 1;
}

.chart-bars-container {
  flex: 1; position: relative; height: 100%;
  display: flex; align-items: flex-end;
}

.grid-line {
  position: absolute; left: 0; right: 0; height: 1px;
  background-color: var(--st-grid-line); z-index: 0; pointer-events: none;
}
.line-top { top: 0; border-top: 1px dashed var(--st-grid-line); background: none; }
.line-mid { top: 50%; border-top: 1px dashed var(--st-grid-line); background: none; }
.line-bottom { bottom: 0; background-color: var(--st-grid-line); }

.chart-bars {
  display: flex; width: 100%; height: 100%;
  align-items: flex-end; justify-content: space-between;
  gap: 2px; z-index: 1;
}

.bar-wrapper {
  flex: 1; height: 100%; display: flex; flex-direction: column;
  justify-content: flex-end; align-items: center; position: relative;
}
.bar-fill {
  width: 60%; min-width: 4px;
  border-radius: 2px 2px 0 0; min-height: 2px;
  transition: height 0.4s cubic-bezier(0.17, 0.67, 0.83, 0.67), background-color 0.3s;
  opacity: 0.8;
}
.bar-wrapper:hover .bar-fill { opacity: 1; }
.bar-label {
  position: absolute; bottom: -20px; font-size: 10px;
  color: var(--st-text-sub); width: 20px; text-align: center;
}

.chart-placeholder {
  display: flex; justify-content: center; align-items: center;
  height: 100%; width: 100%; opacity: 0.3;
}
.placeholder-text { font-size: 14px; color: var(--st-text-sub); font-weight: 500; }

@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideUp { from { transform: translateY(20px) scale(0.98); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }
</style>
