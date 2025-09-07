<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Calendar } from 'v-calendar'
import 'v-calendar/dist/style.css'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/utils/supabaseClient'
import NoteItem from '@/components/NoteItem.vue'

const emit = defineEmits(['close', 'editNote', 'copy', 'pin', 'delete'])

const authStore = useAuthStore()
const user = computed(() => authStore.user)

// --- 全新的、更简单的状态 ---
const datesWithNotes = ref<Set<string>>(new Set()) // 只存储有笔记的日期字符串 (YYYY-MM-DD)，用于红点
const selectedDateNotes = ref<any[]>([]) // 只存储当前选中日期的笔记
const selectedDate = ref(new Date())
const isLoadingNotes = ref(false) // 只在加载每日笔记时使用
const expandedNoteId = ref<string | null>(null)

// --- 计算属性：根据 Set 自动生成日历红点 ---
const attributes = computed(() => {
  return Array.from(datesWithNotes.value).map(dateStr => ({
    key: dateStr,
    dot: true,
    dates: new Date(dateStr),
  }))
})

// --- 逻辑1：组件加载时，获取所有笔记的日期用于显示红点 ---
async function fetchAllNoteDates() {
  if (!user.value)
    return
  try {
    const { data, error } = await supabase
      .from('notes')
      .select('created_at')
      .eq('user_id', user.value.id)

    if (error)
      throw error
    if (data) {
      // 关键修改：将每个 UTC 时间先转换为本地 Date 对象，再取其日期字符串
      const dates = new Set(data.map(note => new Date(note.created_at).toDateString()))
      datesWithNotes.value = dates
    }
  }
  catch (err) {
    console.error('获取所有笔记日期失败:', err)
  }
}

// --- 逻辑2：当点击日期时，只获取那一天的笔记 ---
async function fetchNotesForDate(date: Date) {
  if (!user.value)
    return

  selectedDate.value = date
  isLoadingNotes.value = true
  selectedDateNotes.value = [] // 先清空

  try {
    // 关键修改：基于本地时区创建一天的开始和结束
    const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
    const endDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)

    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', user.value.id)
      // .toISOString() 会自动将本地时间转换为正确的 UTC 时间字符串给数据库
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .order('created_at', { ascending: false })

    if (error)
      throw error
    selectedDateNotes.value = data || []
  }
  catch (err: any) {
    console.error(`获取 ${date.toLocaleDateString()} 的笔记失败:`, err)
  }
  finally {
    isLoadingNotes.value = false
  }
}

function toggleExpandInCalendar(noteId: string) {
  if (expandedNoteId.value === noteId)
    expandedNoteId.value = null // 如果点击的是已展开的，就收起
  else
    expandedNoteId.value = noteId // 否则，展开新点击的
}

// --- 组件加载时执行初始化 ---
onMounted(() => {
  fetchAllNoteDates() // 获取所有红点
  fetchNotesForDate(new Date()) // 获取当天的笔记
})
</script>

<template>
  <div class="calendar-view">
    <div class="calendar-header">
      <h2>日历笔记</h2>
      <button class="close-btn" @click="emit('close')">×</button>
    </div>
    <div class="calendar-body">
      <div class="calendar-container">
        <Calendar
          is-expanded
          :attributes="attributes"
          @dayclick="day => fetchNotesForDate(day.date)"
        />
      </div>
      <div class="notes-for-day-container">
        <div class="selected-date-header">
          {{ selectedDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) }}
        </div>
        <div v-if="isLoadingNotes" class="loading-text">加载中...</div>
        <div v-else-if="selectedDateNotes.length > 0" class="notes-list">
          <NoteItem
            v-for="note in selectedDateNotes"
            :key="note.id"
            :note="note"
            :is-expanded="expandedNoteId === note.id"
            @toggle-expand="toggleExpandInCalendar"
            @edit="noteToEdit => emit('editNote', noteToEdit)"

            @copy="content => emit('copy', content)"
            @pin="noteToPin => emit('pin', noteToPin)"
            @delete="noteId => emit('delete', noteId)"
          />
        </div>
        <div v-else class="no-notes-text">
          这一天没有笔记。
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 样式与之前相同 */
.calendar-view {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: white;
  z-index: 100;
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
.dark .no-notes-text {
  color: #aaa;
}
.notes-list {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
</style>
