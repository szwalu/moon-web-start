<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useDark } from '@vueuse/core'
import { Calendar } from 'v-calendar'
import 'v-calendar/dist/style.css'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/utils/supabaseClient'
import { CACHE_KEYS, getCalendarDateCacheKey } from '@/utils/cacheKeys'
import NoteItem from '@/components/NoteItem.vue'

const emit = defineEmits(['close', 'editNote', 'copy', 'pin', 'delete', 'setDate'])

const authStore = useAuthStore()
const user = computed(() => authStore.user)
const isDark = useDark()

const datesWithNotes = ref<Set<string>>(new Set())
const selectedDateNotes = ref<any[]>([])
const selectedDate = ref(new Date())
const isLoadingNotes = ref(false)
const expandedNoteId = ref<string | null>(null)
const scrollBodyRef = ref<HTMLElement | null>(null)

/** 本地元信息键：最近一次同步时间戳 & 总数 */
const CAL_LAST_SYNC_TS = 'calendar_last_sync_ts'
const CAL_LAST_TOTAL = 'calendar_last_total'

/** 工具：把任意日期归一到“自然日”的 key（toDateString） */
function dateKeyStr(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toDateString()
}
function toDateKeyStrFromISO(iso: string) {
  return dateKeyStr(new Date(iso))
}

/* ===================== 事件处理（逐行写法，避免 max-statements-per-line） ===================== */
function handleEdit(note: any) {
  emit('editNote', note)
}
function handleCopy(content: string) {
  emit('copy', content)
}
function handlePin(note: any) {
  emit('pin', note)
}
function handleDelete(noteId: string) {
  emit('delete', noteId)
}
function handleDateUpdated() {
  refreshData()
}
function handleHeaderClick() {
  if (scrollBodyRef.value)
    scrollBodyRef.value.scrollTo({ top: 0, behavior: 'smooth' })
}
function toggleExpandInCalendar(noteId: string) {
  expandedNoteId.value = expandedNoteId.value === noteId ? null : noteId
}

/* ===================== 日历点（小圆点） ===================== */
const attributes = computed(() => {
  return Array.from(datesWithNotes.value).map(dateStr => ({
    key: dateStr,
    dot: true,
    dates: new Date(dateStr),
  }))
})

/* ===================== 全量：获取所有有笔记的日期集合 ===================== */
async function fetchAllNoteDatesFull() {
  if (!user.value)
    return

  const { data, error } = await supabase
    .from('notes')
    .select('created_at')
    .eq('user_id', user.value.id)

  if (error)
    throw error

  const dateStrings = (data || []).map(n => toDateKeyStrFromISO(n.created_at))
  datesWithNotes.value = new Set(dateStrings)
  localStorage.setItem(CACHE_KEYS.CALENDAR_ALL_DATES, JSON.stringify(dateStrings))
}

/* ===================== 从缓存恢复日期点 ===================== */
function loadAllDatesFromCache(): boolean {
  const cached = localStorage.getItem(CACHE_KEYS.CALENDAR_ALL_DATES)
  if (!cached)
    return false

  try {
    const arr: string[] = JSON.parse(cached)
    datesWithNotes.value = new Set(arr)
    return true
  }
  catch {
    localStorage.removeItem(CACHE_KEYS.CALENDAR_ALL_DATES)
    return false
  }
}

/* ===================== 获取某日笔记：优先读缓存，缺失再拉取 ===================== */
async function fetchNotesForDate(date: Date) {
  if (!user.value)
    return

  selectedDate.value = date
  expandedNoteId.value = null

  const cacheKey = getCalendarDateCacheKey(date)
  const cachedData = localStorage.getItem(cacheKey)

  if (cachedData) {
    try {
      selectedDateNotes.value = JSON.parse(cachedData)
      return
    }
    catch {
      localStorage.removeItem(cacheKey)
    }
  }

  isLoadingNotes.value = true
  selectedDateNotes.value = []

  try {
    const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
    const endDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)

    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', user.value.id)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .order('created_at', { ascending: false })

    if (error)
      throw error

    selectedDateNotes.value = data || []
    localStorage.setItem(cacheKey, JSON.stringify(selectedDateNotes.value))
  }
  catch (err) {
    console.error(`获取 ${date.toLocaleDateString()} 的笔记失败:`, err)
  }
  finally {
    isLoadingNotes.value = false
  }
}

/* ===================== 轻量校验 & 增量刷新 ===================== */
async function checkAndRefreshIncremental() {
  if (!user.value)
    return

  const lastSync = Number(localStorage.getItem(CAL_LAST_SYNC_TS) || '0') || 0
  const lastTotal = Number(localStorage.getItem(CAL_LAST_TOTAL) || '0') || 0

  // 1) 服务器总数
  let serverTotal = 0
  try {
    const { count, error } = await supabase
      .from('notes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.value.id)

    if (error)
      throw error

    serverTotal = count || 0
  }
  catch (e) {
    console.warn('获取笔记总数失败，跳过增量校验。', e)
    return
  }

  // 2) 最新更新时间
  let serverMaxUpdatedAt = 0
  try {
    const { data, error } = await supabase
      .from('notes')
      .select('updated_at')
      .eq('user_id', user.value.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()

    if (error && (error as any).code !== 'PGRST116')
      throw error

    if (data?.updated_at)
      serverMaxUpdatedAt = new Date(data.updated_at).getTime()
  }
  catch (e) {
    console.warn('获取 max(updated_at) 失败，跳过增量校验。', e)
    return
  }

  // 3) 无变化
  if (serverTotal === lastTotal && serverMaxUpdatedAt <= lastSync)
    return

  // 4) 总数减少（可能跨端删除）：全量重算日期集合
  if (serverTotal < lastTotal) {
    try {
      await fetchAllNoteDatesFull()
    }
    catch (e) {
      console.error('全量重算日期集合失败：', e)
    }
    await refetchSelectedDateAndMarkSync(serverTotal, serverMaxUpdatedAt)
    return
  }

  // 5) 仅新增/编辑：增量合并
  try {
    if (serverMaxUpdatedAt > lastSync) {
      const sinceISO = new Date(lastSync || 0).toISOString()

      const { data, error } = await supabase
        .from('notes')
        .select('id, created_at, updated_at')
        .eq('user_id', user.value.id)
        .gt('updated_at', sinceISO)

      if (error)
        throw error

      const affectedDateKeys = new Set<string>()

      for (const row of (data || [])) {
        const key = toDateKeyStrFromISO(row.created_at)
        affectedDateKeys.add(key)
        datesWithNotes.value.add(key) // 新增会增加圆点；编辑不影响
      }

      // 清理这些日期的日缓存
      affectedDateKeys.forEach((keyStr) => {
        const partsDate = new Date(keyStr)
        const dayCacheKey = getCalendarDateCacheKey(partsDate)
        localStorage.removeItem(dayCacheKey)
      })

      // 覆盖写“所有日期”缓存
      localStorage.setItem(
        CACHE_KEYS.CALENDAR_ALL_DATES,
        JSON.stringify(Array.from(datesWithNotes.value)),
      )
    }
  }
  catch (e) {
    console.error('增量刷新失败：', e)
  }

  await refetchSelectedDateAndMarkSync(serverTotal, serverMaxUpdatedAt)
}

async function refetchSelectedDateAndMarkSync(serverTotal: number, serverMaxUpdatedAt: number) {
  await fetchNotesForDate(selectedDate.value)
  localStorage.setItem(CAL_LAST_TOTAL, String(serverTotal))
  localStorage.setItem(CAL_LAST_SYNC_TS, String(serverMaxUpdatedAt || Date.now()))
}

/* ===================== 生命周期（先缓存再校验） ===================== */
onMounted(async () => {
  const hadCache = loadAllDatesFromCache()
  if (!hadCache && user.value) {
    try {
      await fetchAllNoteDatesFull()
    }
    catch {
      // 忽略初始化失败
    }
  }

  await fetchNotesForDate(new Date())
  checkAndRefreshIncremental()
})

/* ===================== 暴露方法：供父组件在主页修改后主动刷新 ===================== */
function refreshData() {
  checkAndRefreshIncremental()
}
defineExpose({ refreshData })
</script>

<template>
  <div class="calendar-view">
    <div class="calendar-header" @click="handleHeaderClick">
      <h2>日历</h2>
      <button class="close-btn" @click.stop="emit('close')">×</button>
    </div>
    <div ref="scrollBodyRef" class="calendar-body">
      <div class="calendar-container">
        <Calendar
          is-expanded
          :attributes="attributes"
          :is-dark="isDark"
          @dayclick="day => fetchNotesForDate(day.date)"
        />
      </div>

      <div class="notes-for-day-container">
        <div class="selected-date-header">
          {{ selectedDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) }}
        </div>

        <div v-if="isLoadingNotes" class="loading-text">加载中...</div>

        <div v-else-if="selectedDateNotes.length > 0" class="notes-list">
          <div v-for="note in selectedDateNotes" :key="note.id">
            <NoteItem
              :note="note"
              :is-expanded="expandedNoteId === note.id"
              :dropdown-in-place="true"
              :show-internal-collapse-button="true"
              @toggle-expand="toggleExpandInCalendar"
              @edit="handleEdit"
              @copy="handleCopy"
              @pin="handlePin"
              @delete="handleDelete"
              @dblclick="handleEdit(note)"
              @date-updated="handleDateUpdated"
              @set-date="(note) => emit('setDate', note)"
            />
          </div>
        </div>

        <div v-else class="no-notes-text">这一天没有笔记。</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.calendar-view {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: white;
  z-index: 5000;
  display: flex;
  flex-direction: column;
  color: #333;
}
.dark .calendar-view {
  background: #1e1e1e;
  color: #f0f0f0;
}
.calendar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1.5rem;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
  cursor: pointer;
}
.dark .calendar-header {
  border-bottom-color: #374151;
}
.calendar-header h2 {
  font-size: 22px;
  font-weight: 600;
  margin: 0;
}
.close-btn {
  font-size: 28px;
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
}
.calendar-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  position: relative;
}
.calendar-container {
  padding: 1rem;
  border-bottom: 1px solid #e5e7eb;
}
.dark .calendar-container {
  border-bottom-color: #374151;
}
:deep(.vc-container) {
  border: none;
  font-family: inherit;
  width: 100%;
}
.dark :deep(.vc-container) {
  background: transparent;
  color: #f0f0f0;
}
.notes-for-day-container {
  padding: 1rem 1.5rem;
}
.selected-date-header {
  font-weight: 600;
  margin-bottom: 1rem;
}
.loading-text,
.no-notes-text {
  text-align: center;
  color: #888;
  padding: 2rem;
}
.dark .loading-text,
.dark .no-notes-text {
  color: #aaa;
}
.notes-list {
  display: flex;
  flex-direction: column;
}
.notes-list > div {
  margin-bottom: 1.5rem;
}
.notes-list > div:last-child {
  margin-bottom: 0;
}
</style>

<style>
.n-dialog__mask,
.n-modal-mask {
  z-index: 6002 !important;
}
.n-dialog,
.n-dialog__container,
.n-modal,
.n-modal-container {
  z-index: 6003 !important;
}
.n-message-container,
.n-notification-container,
.n-popover,
.n-dropdown {
  z-index: 6004 !important;
}
</style>
