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

// --- 事件处理器 (已修复 max-statements-per-line 错误) ---
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
  selectedDateNotes.value = selectedDateNotes.value.filter(n => n.id !== noteId)
  emit('delete', noteId)
}
function handleDateUpdated() {
  refreshData()
}
function handleHeaderClick() {
  scrollBodyRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

function toggleExpandInCalendar(noteId: string) {
  expandedNoteId.value = expandedNoteId.value === noteId ? null : noteId
}

// --- 数据获取 ---
const attributes = computed(() => {
  return Array.from(datesWithNotes.value).map(dateStr => ({
    key: dateStr,
    dot: true,
    dates: new Date(dateStr),
  }))
})

async function fetchAllNoteDates() {
  if (!user.value)
    return
  const cachedData = localStorage.getItem(CACHE_KEYS.CALENDAR_ALL_DATES)
  if (cachedData) {
    datesWithNotes.value = new Set(JSON.parse(cachedData))
    return
  }
  try {
    const { data, error } = await supabase.from('notes').select('created_at').eq('user_id', user.value.id)
    if (error)
      throw error
    if (data) {
      const dateStrings = data.map(note => new Date(note.created_at).toDateString())
      datesWithNotes.value = new Set(dateStrings)
      localStorage.setItem(CACHE_KEYS.CALENDAR_ALL_DATES, JSON.stringify(dateStrings))
    }
  }
  catch (err) { console.error('获取所有笔记日期失败:', err) }
}

async function fetchNotesForDate(date: Date) {
  if (!user.value)
    return
  selectedDate.value = date
  expandedNoteId.value = null
  const cacheKey = getCalendarDateCacheKey(date)
  const cachedData = localStorage.getItem(cacheKey)
  if (cachedData) {
    selectedDateNotes.value = JSON.parse(cachedData)
    return
  }
  isLoadingNotes.value = true
  selectedDateNotes.value = []
  try {
    const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
    const endDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
    const { data, error } = await supabase.from('notes').select('*').eq('user_id', user.value.id).gte('created_at', startDate.toISOString()).lte('created_at', endDate.toISOString()).order('created_at', { ascending: false })
    if (error)
      throw error
    selectedDateNotes.value = data || []
    localStorage.setItem(cacheKey, JSON.stringify(selectedDateNotes.value))
  }
  catch (err: any) { console.error(`获取 ${date.toLocaleDateString()} 的笔记失败:`, err) }
  finally { isLoadingNotes.value = false }
}

function refreshData() {
  localStorage.removeItem(CACHE_KEYS.CALENDAR_ALL_DATES)
  localStorage.removeItem(getCalendarDateCacheKey(selectedDate.value))
  fetchAllNoteDates()
  fetchNotesForDate(selectedDate.value)
}

// --- 生命周期钩子 ---
onMounted(() => {
  fetchAllNoteDates()
  fetchNotesForDate(new Date())
})

defineExpose({
  refreshData,
})
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
          <div
            v-for="note in selectedDateNotes"
            :key="note.id"
          >
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

        <div v-else class="no-notes-text">
          这一天没有笔记。
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 样式部分保持不变 */
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
.loading-text, .no-notes-text {
  text-align: center;
  color: #888;
  padding: 2rem;
}
.dark .loading-text, .dark .no-notes-text {
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

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
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
.n-popover, .n-dropdown {
  z-index: 6004 !important;
}
</style>
