<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useDark } from '@vueuse/core'
import { Calendar } from 'v-calendar'
import 'v-calendar/dist/style.css'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/utils/supabaseClient'
import { CACHE_KEYS, getCalendarDateCacheKey } from '@/utils/cacheKeys'
import NoteItem from '@/components/NoteItem.vue'
import NoteEditor from '@/components/NoteEditor.vue'

const emit = defineEmits(['close', 'editNote', 'copy', 'pin', 'delete', 'setDate', 'created', 'updated'])

const { t } = useI18n()
const isDark = useDark()
const authStore = useAuthStore()
const user = computed(() => authStore.user)

const allTags = ref<string[]>([])
const tagCounts = ref<Record<string, number>>({})
const datesWithNotes = ref<Set<string>>(new Set())
const selectedDateNotes = ref<any[]>([])
const selectedDate = ref(new Date())
const isLoadingNotes = ref(false)
const expandedNoteId = ref<string | null>(null)

const scrollBodyRef = ref<HTMLElement | null>(null)
const newNoteEditorRef = ref<InstanceType<typeof NoteEditor> | null>(null)
const editNoteEditorRef = ref<InstanceType<typeof NoteEditor> | null>(null)

/* ===== 写作 / 编辑状态 ===== */
const isWriting = ref(false)
const newNoteContent = ref('')
const writingKey = computed(() => `calendar_draft_${dateKeyStr(selectedDate.value)}`)

const editingNote = ref<any | null>(null)
const editContent = ref('')
const isEditingExisting = computed(() => !!editingNote.value)
const editDraftKey = computed(() => (editingNote.value ? `calendar_edit_${editingNote.value.id}` : ''))

/* 行内编辑器容器：用于“轻量确保在可视区内” */
const wrapNewRef = ref<HTMLElement | null>(null)
const wrapEditRef = ref<HTMLElement | null>(null)

/* ===== 仅保留最小父职责：写 CSS 变量 ===== */
function setKbPad(px: number) {
  const el = scrollBodyRef.value
  if (!el)
    return
  const v = Math.max(0, Math.floor(Number(px) || 0))
  el.style.setProperty('--kb-pad', `${v}px`)
}

/* 交给 NoteEditor 的回调：不再做任何二次补偿或主动滚动 */
function onEditorBottomSafeChange(px: number) {
  setKbPad(px)
}

/* 焦点时仅隐藏头部，不主动滚动 */
const hideHeader = ref(false)
function onEditorFocus() {
  hideHeader.value = true
}

/* 轻量“确保行内编辑器在可视区内”（非强制） */
function ensureInlineEditorVisible() {
  const container = scrollBodyRef.value
  const wrapper = isWriting.value ? wrapNewRef.value : (isEditingExisting.value ? wrapEditRef.value : null)
  if (!container || !wrapper)
    return

  const cTop = container.scrollTop
  const cH = container.clientHeight
  const pad = Number.parseFloat(getComputedStyle(container).getPropertyValue('--kb-pad')) || 0
  const viewBottom = cTop + Math.max(0, cH - pad) - 8 // 略留 8px 余量

  const wTop = wrapper.offsetTop
  const wBottom = wTop + wrapper.offsetHeight

  if (wBottom > viewBottom)
    container.scrollTo({ top: wBottom - (cH - pad) + 8, behavior: 'auto' })
  else if (wTop < cTop)
    container.scrollTo({ top: wTop - 8, behavior: 'auto' })
}

/* 点击日历浮层外部时退出写作/编辑 */
const rootRef = ref<HTMLElement | null>(null)
function onGlobalClickCapture(e: MouseEvent) {
  if (!isWriting.value && !isEditingExisting.value)
    return
  const target = e.target as HTMLElement | null
  if (!target)
    return
  if (!rootRef.value?.contains(target))
    return
  if (target.closest('.inline-editor'))
    return

  isWriting.value = false
  editingNote.value = null
  hideHeader.value = false
}
onMounted(() => {
  document.addEventListener('click', onGlobalClickCapture, true)
})
onUnmounted(() => {
  document.removeEventListener('click', onGlobalClickCapture, true)
})

/* ===================== 标签数据 ===================== */
async function fetchTagData() {
  if (!user.value)
    return

  try {
    const { data: tagsData, error: tagsError } = await supabase.rpc('get_unique_tags', { p_user_id: user.value.id })
    if (tagsError)
      throw tagsError
    allTags.value = tagsData || []

    const { data: countsData, error: countsError } = await supabase.rpc('get_tag_counts', { p_user_id: user.value.id })
    if (countsError)
      throw countsError

    const countsObject = (countsData || []).reduce((acc, item) => {
      acc[item.tag] = item.cnt
      return acc
    }, {} as Record<string, number>)
    tagCounts.value = countsObject
  }
  catch (e) {
    console.error('从数据库获取标签数据失败:', e)
  }
}

/* ===================== 工具函数 ===================== */
const CAL_LAST_SYNC_TS = 'calendar_last_sync_ts'
const CAL_LAST_TOTAL = 'calendar_last_total'

function dateKeyStr(d: Date) {
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  const mm = m < 10 ? `0${m}` : `${m}`
  const dd = day < 10 ? `0${day}` : `${day}`
  return `${y}-${mm}-${dd}`
}
function toDateKeyStrFromISO(iso: string) {
  return dateKeyStr(new Date(iso))
}
function dateFromKeyStr(key: string) {
  const [y, m, d] = key.split('-').map(n => Number(n))
  return new Date(y, (m - 1), d)
}

/* ===================== 事件处理 ===================== */
async function handleEdit(note: any) {
  editingNote.value = note
  editContent.value = note?.content || ''
  isWriting.value = false
  expandedNoteId.value = null
  hideHeader.value = true

  scrollBodyRef.value?.scrollTo({ top: 0, behavior: 'auto' })

  await nextTick()
  ensureInlineEditorVisible()
  requestAnimationFrame(() => {
    ensureInlineEditorVisible()
  })
  window.setTimeout(() => {
    ensureInlineEditorVisible()
  }, 120)

  if (editNoteEditorRef.value)
    safeFocusEditor(editNoteEditorRef.value)
}
function handleCopy(content: string) {
  emit('copy', content)
}
function handlePin(note: any) {
  emit('pin', note)
}
async function handleDelete(noteId: string) {
  emit('delete', noteId)
  selectedDateNotes.value = selectedDateNotes.value.filter(n => n.id !== noteId)

  const dayCacheKey = getCalendarDateCacheKey(selectedDate.value)
  if (selectedDateNotes.value.length > 0)
    localStorage.setItem(dayCacheKey, JSON.stringify(selectedDateNotes.value))
  else
    localStorage.removeItem(dayCacheKey)

  refreshDotAfterDelete()
}
function handleDateUpdated() {
  refreshData()
}
function handleHeaderClick() {
  scrollBodyRef.value?.scrollTo({ top: 0, behavior: 'auto' })
}
function toggleExpandInCalendar(noteId: string) {
  expandedNoteId.value = expandedNoteId.value === noteId ? null : noteId
}

/* ===================== 日历点 ===================== */
const attributes = computed(() => {
  const attrs: any[] = []
  datesWithNotes.value.forEach((key) => {
    attrs.push({ key: `note-${key}`, dot: true, dates: dateFromKeyStr(key) })
  })
  const today = new Date()
  attrs.push({
    key: 'today-highlight',
    dates: today,
    highlight: { color: 'blue', fillMode: 'outline', contentClass: 'today-outline' },
  })
  return attrs
})

/* ===================== 所有日期集合 ===================== */
async function fetchAllNoteDatesFull() {
  if (!user.value)
    return

  const PAGE = 1000
  let from = 0
  let to = PAGE - 1
  const acc = new Set<string>()
  while (true) {
    const { data, error } = await supabase
      .from('notes')
      .select('created_at')
      .eq('user_id', user.value.id)
      .order('created_at', { ascending: false })
      .range(from, to)
    if (error)
      throw error

    const rows = data || []
    rows.forEach((n) => {
      acc.add(toDateKeyStrFromISO(n.created_at))
    })
    const last = !data || data.length < PAGE
    if (last)
      break
    from += PAGE
    to += PAGE
  }
  datesWithNotes.value = new Set(acc)
  localStorage.setItem(CACHE_KEYS.CALENDAR_ALL_DATES, JSON.stringify(Array.from(acc)))
}

/* ===================== 从缓存恢复日期点 ===================== */
function loadAllDatesFromCache(): boolean {
  const cached = localStorage.getItem(CACHE_KEYS.CALENDAR_ALL_DATES)
  if (!cached)
    return false

  try {
    const arr: string[] = JSON.parse(cached)
    const normalized = arr.map((s) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(s))
        return s
      const d = new Date(s)
      if (Number.isNaN(d.getTime()))
        return s
      return dateKeyStr(d)
    })
    datesWithNotes.value = new Set(normalized)
    localStorage.setItem(CACHE_KEYS.CALENDAR_ALL_DATES, JSON.stringify(normalized))
    return true
  }
  catch {
    localStorage.removeItem(CACHE_KEYS.CALENDAR_ALL_DATES)
    return false
  }
}

/* ===================== 编辑保存 ===================== */
async function saveExistingNote(content: string, _weather?: string | null) {
  if (!user.value || !editingNote.value)
    return

  const id = editingNote.value.id
  const trimmed = (content || '').trim()
  if (!trimmed)
    return

  try {
    const nowISO = new Date().toISOString()
    const { data, error } = await supabase
      .from('notes')
      .update({ content: trimmed, updated_at: nowISO })
      .eq('id', id)
      .eq('user_id', user.value.id)
      .select('*')
      .single()
    if (error)
      throw error

    selectedDateNotes.value = selectedDateNotes.value.map(n => (n.id === id ? data : n))
    localStorage.setItem(getCalendarDateCacheKey(selectedDate.value), JSON.stringify(selectedDateNotes.value))
    emit('updated', data)
  }
  catch (e) {
    console.error('更新笔记失败：', e)
    return
  }

  editingNote.value = null
  editContent.value = ''
  hideHeader.value = false
}
function cancelEditExisting() {
  editingNote.value = null
  editContent.value = ''
  hideHeader.value = false
}

/* ===================== 某日笔记（缓存优先） ===================== */
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
    }
    catch {
      localStorage.removeItem(cacheKey)
    }
  }

  const hasCache = !!localStorage.getItem(cacheKey)
  if (!hasCache) {
    isLoadingNotes.value = true
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
      selectedDateNotes.value = []
    }
    finally {
      isLoadingNotes.value = false
    }
  }

  const key = dateKeyStr(date)
  const hasNotes = selectedDateNotes.value.length > 0
  const hasDot = datesWithNotes.value.has(key)
  if (hasNotes !== hasDot) {
    if (hasNotes)
      datesWithNotes.value.add(key)
    else
      datesWithNotes.value.delete(key)

    datesWithNotes.value = new Set(datesWithNotes.value)
    localStorage.setItem(CACHE_KEYS.CALENDAR_ALL_DATES, JSON.stringify(Array.from(datesWithNotes.value)))
  }
}

/* 删除后校准蓝点 */
function refreshDotAfterDelete() {
  const key = dateKeyStr(selectedDate.value)
  const hasNotes = selectedDateNotes.value.length > 0
  const hasDot = datesWithNotes.value.has(key)
  if (hasNotes && !hasDot)
    datesWithNotes.value.add(key)
  else if (!hasNotes && hasDot)
    datesWithNotes.value.delete(key)

  datesWithNotes.value = new Set(datesWithNotes.value)
  localStorage.setItem(CACHE_KEYS.CALENDAR_ALL_DATES, JSON.stringify(Array.from(datesWithNotes.value)))
}

/* ===================== 轻量校验 & 增量刷新 ===================== */
async function checkAndRefreshIncremental() {
  if (!user.value)
    return

  const lastSync = Number(localStorage.getItem(CAL_LAST_SYNC_TS) || '0') || 0
  const lastTotal = Number(localStorage.getItem(CAL_LAST_TOTAL) || '0') || 0

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

  const noChange = serverTotal === lastTotal && serverMaxUpdatedAt <= lastSync
  if (noChange)
    return

  const decreased = serverTotal < lastTotal
  if (decreased) {
    try {
      await fetchAllNoteDatesFull()
    }
    catch (e) {
      console.error('全量重算日期集合失败：', e)
    }
    await refetchSelectedDateAndMarkSync(serverTotal, serverMaxUpdatedAt)
    return
  }

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
      let added = false
      ;(data || []).forEach((row) => {
        const key = toDateKeyStrFromISO(row.created_at)
        affectedDateKeys.add(key)
        if (!datesWithNotes.value.has(key)) {
          datesWithNotes.value.add(key)
          added = true
        }
      })
      if (added)
        datesWithNotes.value = new Set(datesWithNotes.value)

      affectedDateKeys.forEach((keyStr) => {
        const partsDate = dateFromKeyStr(keyStr)
        const dayCacheKey = getCalendarDateCacheKey(partsDate)
        localStorage.removeItem(dayCacheKey)
      })
      localStorage.setItem(CACHE_KEYS.CALENDAR_ALL_DATES, JSON.stringify(Array.from(datesWithNotes.value)))
    }
  }
  catch (e) {
    console.error('增量刷新失败：', e)
  }

  await refetchSelectedDateAndMarkSync(serverTotal, serverMaxUpdatedAt)
}

async function refetchSelectedDateAndMarkSync(total: number, maxUpdatedAt: number) {
  const dayCacheKey = getCalendarDateCacheKey(selectedDate.value)
  localStorage.removeItem(dayCacheKey)
  await fetchNotesForDate(selectedDate.value)
  localStorage.setItem(CAL_LAST_TOTAL, String(total))
  localStorage.setItem(CAL_LAST_SYNC_TS, String(maxUpdatedAt || Date.now()))
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible')
    checkAndRefreshIncremental()
}

/* ===================== 生命周期 ===================== */
onMounted(async () => {
  fetchTagData()
  const hadCache = loadAllDatesFromCache()
  if (!hadCache && user.value) {
    try {
      await fetchAllNoteDatesFull()
    }
    catch {
      /* ignore */
    }
  }
  await fetchNotesForDate(new Date())
  await checkAndRefreshIncremental()
  document.addEventListener('visibilitychange', handleVisibilityChange)
})
onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})

/* ===================== 暴露方法 ===================== */
function refreshData() {
  checkAndRefreshIncremental()
}
defineExpose({ refreshData })

/* ===================== 新建流程 ===================== */
async function startWriting() {
  isWriting.value = true
  hideHeader.value = true
  scrollBodyRef.value?.scrollTo({ top: 0, behavior: 'auto' })

  await nextTick()
  ensureInlineEditorVisible()
  requestAnimationFrame(() => ensureInlineEditorVisible())
  window.setTimeout(() => ensureInlineEditorVisible(), 120)
  if (newNoteEditorRef.value)
    safeFocusEditor(newNoteEditorRef.value)
}

const composeButtonText = computed(() => {
  const sel = selectedDate.value
  const now = new Date()
  const selDay = new Date(sel.getFullYear(), sel.getMonth(), sel.getDate())
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const labelDate = sel.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
  if (selDay < today)
    return t('notes.calendar.compose_backfill', { date: labelDate })
  return t('notes.calendar.compose_write', { date: labelDate })
})

function cancelWriting() {
  isWriting.value = false
  hideHeader.value = false
}

function buildCreatedAtForSelectedDay(): string {
  const day = new Date(selectedDate.value)
  const now = new Date()
  day.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds())
  return day.toISOString()
}

async function saveNewNote(content: string, weather: string | null) {
  if (!user.value || !content.trim())
    return

  const createdISO = buildCreatedAtForSelectedDay()
  const { data, error } = await supabase
    .from('notes')
    .insert({
      user_id: user.value.id,
      content: content.trim(),
      created_at: createdISO,
      updated_at: createdISO,
      weather,
    })
    .select('*')
    .single()
  if (error) {
    console.error('保存失败：', error)
    return
  }

  selectedDateNotes.value = [data, ...selectedDateNotes.value]
  const key = dateKeyStr(selectedDate.value)
  const hasDot = datesWithNotes.value.has(key)
  if (!hasDot) {
    datesWithNotes.value.add(key)
    datesWithNotes.value = new Set(datesWithNotes.value)
    localStorage.setItem(CACHE_KEYS.CALENDAR_ALL_DATES, JSON.stringify(Array.from(datesWithNotes.value)))
  }
  localStorage.setItem(getCalendarDateCacheKey(selectedDate.value), JSON.stringify(selectedDateNotes.value))
  emit('created', data)

  isWriting.value = false
  newNoteContent.value = ''
  hideHeader.value = false
}

/* ===================== 输入监听（无需主动 nudge） ===================== */
/* 保留空壳，便于后续接回调试；当前不做任何操作 */
function safeFocusEditor(comp: any) {
  try {
    comp?.focus?.({ preventScroll: true })
  }
  catch {}

  try {
    comp?.$el?.querySelector?.('textarea')?.focus({ preventScroll: true })
  }
  catch {}
}
</script>

<template>
  <div ref="rootRef" class="calendar-view">
    <div v-show="!hideHeader" class="calendar-header" @click="handleHeaderClick">
      <h2>{{ t('notes.calendar.title') }}</h2>
      <button class="close-btn" @click.stop="emit('close')">×</button>
    </div>

    <!-- 滚动容器：仅由 --kb-pad 控制补偿 -->
    <div ref="scrollBodyRef" class="calendar-body">
      <div v-show="!isWriting && !isEditingExisting" class="calendar-container">
        <Calendar
          is-expanded
          :attributes="attributes"
          :is-dark="isDark"
          @dayclick="day => fetchNotesForDate(day.date)"
        />
      </div>

      <div class="notes-for-day-container">
        <div v-if="!isWriting && !isEditingExisting" class="compose-row">
          <button class="compose-btn" @click="startWriting">
            {{ composeButtonText }}
          </button>
        </div>

        <!-- 新建态 -->
        <div v-if="isWriting" ref="wrapNewRef" class="inline-editor">
          <NoteEditor
            ref="newNoteEditorRef"
            v-model="newNoteContent"
            :is-editing="false"
            :is-loading="false"
            :max-note-length="20000"
            :placeholder="t('notes.calendar.placeholder_new')"
            :all-tags="allTags"
            :tag-counts="tagCounts"
            :enable-drafts="true"
            :draft-key="writingKey"
            :clear-draft-on-save="true"
            @save="saveNewNote"
            @cancel="cancelWriting"
            @bottom-safe-change="onEditorBottomSafeChange"
            @focus="onEditorFocus"
          />
        </div>

        <!-- 编辑态 -->
        <div v-if="isEditingExisting" ref="wrapEditRef" class="inline-editor">
          <NoteEditor
            ref="editNoteEditorRef"
            v-model="editContent"
            :is-editing="true"
            :is-loading="false"
            :max-note-length="20000"
            :placeholder="t('notes.calendar.placeholder_edit')"
            :all-tags="allTags"
            :tag-counts="tagCounts"
            :enable-drafts="true"
            :draft-key="editDraftKey"
            :clear-draft-on-save="true"
            @save="saveExistingNote"
            @cancel="cancelEditExisting"
            @bottom-safe-change="onEditorBottomSafeChange"
            @focus="onEditorFocus"
          />
        </div>

        <div v-if="isLoadingNotes" class="loading-text">
          {{ t('notes.calendar.loading') }}
        </div>

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

        <div v-else class="no-notes-text">
          {{ t('notes.calendar.no_notes_for_day') }}
        </div>

        <!-- 统一由 --kb-pad 控制底部补偿 -->
        <div class="kb-spacer-global" />
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
  padding-top: var(--safe-top);
  padding-bottom: var(--safe-bottom);
}
.dark .calendar-view { background: #1e1e1e; color: #f0f0f0; }

.calendar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: calc(0.5rem + 0px) 1.5rem 0.75rem 1.5rem;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
  cursor: pointer;
  position: sticky;
  top: var(--safe-top);
  z-index: 1;
}
.dark .calendar-header { border-bottom-color: #374151; }
.calendar-header h2 { font-size: 18px; font-weight: 600; margin: 0; }
.close-btn { font-size: 28px; background: none; border: none; cursor: pointer; color: inherit; }

.calendar-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  position: relative;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  /* ✅ 关键：由 NoteEditor 提供的像素，父容器只负责消费 */
  --kb-pad: 0px;
  scroll-padding-bottom: var(--kb-pad);
}

.calendar-container { padding: 1rem; border-bottom: 1px solid #e5e7eb; }
.dark .calendar-container { border-bottom-color: #374151; }
:deep(.vc-container) { border: none; font-family: inherit; width: 100%; }
.dark :deep(.vc-container) { background: transparent; color: #f0f0f0; }

.notes-for-day-container { padding: 1rem 1.5rem; }
.selected-date-header { font-weight: 600; margin-bottom: 1rem; }
.loading-text, .no-notes-text { text-align: center; color: #888; padding: 2rem; }
.dark .loading-text, .dark .no-notes-text { color: #aaa; }
.notes-list { display: flex; flex-direction: column; }
.notes-list > div { margin-bottom: 1.5rem; }
.notes-list > div:last-child { margin-bottom: 0; }

/* 新建态/编辑态下的 textarea 最大高度（和主页一致） */
:deep(.inline-editor .note-editor-reborn:not(.editing-viewport) .editor-textarea) { max-height: 56vh !important; }
:deep(.inline-editor .note-editor-reborn.editing-viewport .editor-textarea) { max-height: 75dvh !important; }

/* spacer：高度由 --kb-pad 控制 */
.kb-spacer-global {
  width: 100%;
  height: var(--kb-pad);
  pointer-events: none;
}

/* 输入框容器与间距 */
.inline-editor { margin-bottom: 16px; }

/* 写笔记按钮行 */
.compose-row { margin: 0 0 12px 0; }
.compose-btn {
  background: #00b386;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 14px;
  cursor: pointer;
}
.compose-btn:hover { background: #009a74; }

/* 隐藏/显示日历的过渡 */
.calendar-container { transition: height 0.2s ease, opacity 0.2s ease; }
</style>

<style>
.n-dialog__mask, .n-modal-mask { z-index: 6002 !important; }
.n-dialog, .n-dialog__container, .n-modal, .n-modal-container { z-index: 6003 !important; }
.n-message-container, .n-notification-container, .n-popover, .n-dropdown { z-index: 6004 !important; }
</style>
