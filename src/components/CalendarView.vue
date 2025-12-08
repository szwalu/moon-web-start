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

import { queuePendingNote, queuePendingUpdate } from '@/utils/offline-db'

const emit = defineEmits(['close', 'editNote', 'copy', 'pin', 'delete', 'setDate', 'created', 'updated'])
const allTags = ref<string[]>([])
const tagCounts = ref<Record<string, number>>({})
const authStore = useAuthStore()
const user = computed(() => authStore.user)
const isDark = useDark()
const { t, locale } = useI18n()
const datesWithNotes = ref<Set<string>>(new Set())
const selectedDateNotes = ref<any[]>([])
const selectedDate = ref(new Date())
const isLoadingNotes = ref(false)
const expandedNoteId = ref<string | null>(null)
const scrollBodyRef = ref<HTMLElement | null>(null)
const newNoteEditorRef = ref<InstanceType<typeof NoteEditor> | null>(null)
const editNoteEditorRef = ref<InstanceType<typeof NoteEditor> | null>(null)

const isWriting = ref(false)
const newNoteContent = ref('')
const writingKey = computed(() => `calendar_draft_${dateKeyStr(selectedDate.value)}`)

// --- 👇 修改后的离线队列函数：复用主界面的同步机制 ---
async function saveToOfflineQueue(action: 'INSERT' | 'UPDATE', note: any) {
  try {
    if (action === 'INSERT') {
      // 复用 offline-db 的新建入队逻辑
      await queuePendingNote(note)
    }
    else if (action === 'UPDATE') {
      // 复用 offline-db 的更新入队逻辑
      // 提取需要更新的字段，避免传入无关的 UI 状态字段
      const updatePayload = {
        content: note.content,
        updated_at: note.updated_at,
        user_id: note.user_id,
        weather: note.weather,
        is_pinned: note.is_pinned || false,
        is_favorited: note.is_favorited || false,
      }
      await queuePendingUpdate(note.id, updatePayload)
    }

    // eslint-disable-next-line no-console
  }
  catch (e) {
    console.error('[Calendar] 写入离线队列失败:', e)
  }
}

async function fetchTagData() {
  if (!user.value)
    return
  try {
    if (!navigator.onLine)
      return // 离线不拉标签
    const { data: tagsData, error: tagsError } = await supabase.rpc('get_unique_tags', {
      p_user_id: user.value.id,
    })
    if (tagsError)
      throw tagsError
    allTags.value = tagsData || []

    const { data: countsData, error: countsError } = await supabase.rpc('get_tag_counts', {
      p_user_id: user.value.id,
    })
    if (countsError)
      throw countsError

    const countsObject = (countsData || []).reduce((acc, item) => {
      acc[item.tag] = item.cnt
      return acc
    }, {} as Record<string, number>)
    tagCounts.value = countsObject
  }
  catch (e) {
    console.warn('从数据库获取标签数据失败(可能是离线):', e)
  }
}

const editingNote = ref<any | null>(null)
const editContent = ref('')
const isEditingExisting = computed(() => !!editingNote.value)
const editDraftKey = computed(() => editingNote.value ? `calendar_edit_${editingNote.value.id}` : '')

const hideHeader = ref(false)

function onEditorFocus() {
  hideHeader.value = true
}

const rootRef = ref<HTMLElement | null>(null)

function onGlobalClickCapture(e: MouseEvent) {
  if (!(isWriting.value || isEditingExisting.value))
    return
  const target = e.target as HTMLElement | null
  if (!target)
    return
  const inThisOverlay = rootRef.value?.contains(target)
  if (!inThisOverlay)
    return
  const inInlineEditor = target.closest('.inline-editor')
  if (inInlineEditor)
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

// -------------------------------------------------------------
// 修改：Save Existing Note (支持离线)
// -------------------------------------------------------------
async function saveExistingNote(content: string) {
  if (!user.value || !editingNote.value)
    return
  const id = editingNote.value.id
  const trimmed = (content || '').trim()
  if (!trimmed)
    return

  // 1. 准备新数据对象
  const nowISO = new Date().toISOString()
  const optimisticNote = {
    ...editingNote.value,
    content: trimmed,
    updated_at: nowISO,
    // 如果需要，可以加一个 dirty 标记
    // _dirty: true
  }

  let finalNote = optimisticNote

  try {
    // 2. 尝试联网更新
    const { data, error } = await supabase
      .from('notes')
      .update({ content: trimmed, updated_at: nowISO })
      .eq('id', id)
      .eq('user_id', user.value.id)
      .select('*')
      .single()

    if (error)
      throw error
    finalNote = data // 如果成功，使用服务器返回的确切数据
  }
  catch (e) {
    // 3. ❌ 失败（离线）：存入本地队列
    console.warn('联网保存失败，转入离线队列:', e)
    await saveToOfflineQueue('UPDATE', optimisticNote)
    // 继续往下走，就像成功了一样更新 UI
  }

  // 4. 更新本地列表
  selectedDateNotes.value = selectedDateNotes.value.map(n => (n.id === id ? finalNote : n))

  // 5. 刷新当天缓存
  localStorage.setItem(
    getCalendarDateCacheKey(selectedDate.value),
    JSON.stringify(selectedDateNotes.value),
  )
  emit('updated', finalNote)

  // 6. 清除草稿并退出
  const draftKey = editDraftKey.value
  if (draftKey) {
    try {
      localStorage.removeItem(draftKey)
    }
    catch {}
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

async function handleEdit(note: any) {
  editingNote.value = note
  editContent.value = note?.content || ''
  isWriting.value = false
  expandedNoteId.value = null
  hideHeader.value = true
  if (scrollBodyRef.value)
    scrollBodyRef.value.scrollTo({ top: 0, behavior: 'smooth' })
  await nextTick()
  editNoteEditorRef.value?.focus()
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
  localStorage.removeItem(CAL_LAST_TOTAL)
  localStorage.removeItem(CAL_LAST_SYNC_TS)
}

async function handleDateUpdated(updatedNote: any) {
  const currentKey = dateKeyStr(selectedDate.value)
  const currentCacheKey = getCalendarDateCacheKey(selectedDate.value)

  localStorage.removeItem(currentCacheKey)
  // 如果离线，fetchNotesForDate 只能读缓存或者读不到，
  // 这里暂时不处理“离线修改日期”的复杂情况（因为涉及到跨日期移动队列）
  await fetchNotesForDate(selectedDate.value)

  let targetKey: string | null = null
  if (updatedNote && updatedNote.created_at) {
    targetKey = toDateKeyStrFromISO(updatedNote.created_at)
    const targetDateObj = new Date(updatedNote.created_at)
    const targetCacheKey = getCalendarDateCacheKey(targetDateObj)
    if (targetKey !== currentKey)
      localStorage.removeItem(targetCacheKey)
  }

  const currentHasNotes = selectedDateNotes.value.length > 0
  if (currentHasNotes)
    datesWithNotes.value.add(currentKey)
  else
    datesWithNotes.value.delete(currentKey)

  if (targetKey)
    datesWithNotes.value.add(targetKey)

  datesWithNotes.value = new Set(datesWithNotes.value)
  localStorage.setItem(
    CACHE_KEYS.CALENDAR_ALL_DATES,
    JSON.stringify(Array.from(datesWithNotes.value)),
  )
  fetchAllNoteDatesFull().catch(() => {})
}

function handleHeaderClick() {
  if (scrollBodyRef.value)
    scrollBodyRef.value.scrollTo({ top: 0, behavior: 'smooth' })
}
function toggleExpandInCalendar(noteId: string) {
  expandedNoteId.value = expandedNoteId.value === noteId ? null : noteId
}

const attributes = computed(() => {
  const attrs: any[] = []
  for (const key of datesWithNotes.value) {
    attrs.push({
      key: `note-${key}`,
      dot: true,
      dates: dateFromKeyStr(key),
    })
  }
  const today = new Date()
  attrs.push({
    key: 'today-highlight',
    dates: today,
    highlight: {
      color: 'blue',
      fillMode: 'outline',
      contentClass: 'today-outline',
    },
  })
  if (selectedDate.value) {
    attrs.push({
      key: 'selected-date',
      dates: selectedDate.value,
      highlight: {
        color: 'blue',
        fillMode: 'light',
      },
    })
  }
  return attrs
})

function formatCalendarHeaderTitle(rawTitle: string) {
  if (!rawTitle)
    return rawTitle
  const parts = rawTitle.split(' ')
  if (parts.length !== 2)
    return rawTitle
  const [monthText, yearText] = parts
  if (!/^\d{4}$/.test(yearText))
    return rawTitle
  const zhMonthMap: Record<string, number> = {
    一月: 1,
    二月: 2,
    三月: 3,
    四月: 4,
    五月: 5,
    六月: 6,
    七月: 7,
    八月: 8,
    九月: 9,
    十月: 10,
    十一月: 11,
    十十二月: 12,
  }
  const monthNum = zhMonthMap[monthText]
  if (!monthNum)
    return rawTitle
  const yearNum = Number(yearText)
  const d = new Date(yearNum, monthNum - 1, 1)
  const lang = String(locale.value || '').toLowerCase()
  if (lang.startsWith('zh'))
    return `${yearText}年${monthNum}月`
  try {
    return new Intl.DateTimeFormat(lang || undefined, { year: 'numeric', month: 'long' }).format(d)
  }
  catch {
    return rawTitle
  }
}

async function fetchAllNoteDatesFull() {
  if (!user.value)
    return
  // 如果离线，直接用本地缓存作为兜底，不强制拉取
  if (!navigator.onLine) {
    loadAllDatesFromCache()
    return
  }

  const PAGE = 1000
  let from = 0
  let to = PAGE - 1
  const acc = new Set<string>()

  try {
    while (true) {
      const { data, error } = await supabase
        .from('notes')
        .select('created_at')
        .eq('user_id', user.value.id)
        .order('created_at', { ascending: false })
        .range(from, to)

      if (error)
        throw error

      ;(data || []).forEach((n) => {
        acc.add(toDateKeyStrFromISO(n.created_at))
      })

      if (!data || data.length < PAGE)
        break
      from += PAGE
      to += PAGE
    }
    datesWithNotes.value = new Set(acc)
    localStorage.setItem(CACHE_KEYS.CALENDAR_ALL_DATES, JSON.stringify(Array.from(acc)))
  }
  catch (e) {
    console.warn('获取全量日期失败(可能离线):', e)
  }
}

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

  // 修改：增加离线判断，如果离线且没缓存，也就没法fetch了
  if (!localStorage.getItem(cacheKey)) {
    isLoadingNotes.value = true
    try {
      if (!navigator.onLine) {
        // 离线且无缓存，只能置空
        selectedDateNotes.value = []
      }
      else {
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
    }
    catch (err) {
      console.error(`获取笔记失败:`, err)
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
    else datesWithNotes.value.delete(key)
    datesWithNotes.value = new Set(datesWithNotes.value)
    localStorage.setItem(
      CACHE_KEYS.CALENDAR_ALL_DATES,
      JSON.stringify(Array.from(datesWithNotes.value)),
    )
  }
}

function refreshDotAfterDelete() {
  const key = dateKeyStr(selectedDate.value)
  const hasNotes = selectedDateNotes.value.length > 0
  const hasDot = datesWithNotes.value.has(key)
  if (hasNotes && !hasDot)
    datesWithNotes.value.add(key)
  else if (!hasNotes && hasDot)
    datesWithNotes.value.delete(key)
  datesWithNotes.value = new Set(datesWithNotes.value)
  localStorage.setItem(
    CACHE_KEYS.CALENDAR_ALL_DATES,
    JSON.stringify(Array.from(datesWithNotes.value)),
  )
}

async function checkAndRefreshIncremental() {
  if (!user.value || !navigator.onLine)
    return // 离线跳过增量检查

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
  catch (e) { return }

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
  catch (e) { return }

  if (serverTotal === lastTotal && serverMaxUpdatedAt <= lastSync)
    return

  if (serverTotal !== lastTotal) {
    try {
      await fetchAllNoteDatesFull()
    }
    catch (e) {}
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
      for (const row of (data || [])) {
        const key = toDateKeyStrFromISO(row.created_at)
        affectedDateKeys.add(key)
        if (!datesWithNotes.value.has(key)) {
          datesWithNotes.value.add(key)
          added = true
        }
      }
      if (added)
        datesWithNotes.value = new Set(datesWithNotes.value)
      affectedDateKeys.forEach((keyStr) => {
        const partsDate = dateFromKeyStr(keyStr)
        const dayCacheKey = getCalendarDateCacheKey(partsDate)
        localStorage.removeItem(dayCacheKey)
      })
      localStorage.setItem(
        CACHE_KEYS.CALENDAR_ALL_DATES,
        JSON.stringify(Array.from(datesWithNotes.value)),
      )
    }
  }
  catch (e) {}
  await refetchSelectedDateAndMarkSync(serverTotal, serverMaxUpdatedAt)
}

async function refetchSelectedDateAndMarkSync(serverTotal: number, serverMaxUpdatedAt: number) {
  const dayCacheKey = getCalendarDateCacheKey(selectedDate.value)
  localStorage.removeItem(dayCacheKey)
  await fetchNotesForDate(selectedDate.value)
  localStorage.setItem(CAL_LAST_TOTAL, String(serverTotal))
  localStorage.setItem(CAL_LAST_SYNC_TS, String(serverMaxUpdatedAt || Date.now()))
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible')
    checkAndRefreshIncremental()
}

onMounted(async () => {
  fetchTagData()
  const hadCache = loadAllDatesFromCache()
  if (!hadCache && user.value) {
    try {
      await fetchAllNoteDatesFull()
    }
    catch {}
  }
  await fetchNotesForDate(new Date())
  await checkAndRefreshIncremental()
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

function refreshData() {
  checkAndRefreshIncremental()
}
defineExpose({ refreshData })

async function startWriting() {
  isWriting.value = true
  hideHeader.value = true
  if (scrollBodyRef.value)
    scrollBodyRef.value.scrollTo({ top: 0, behavior: 'smooth' })
  await nextTick()
  newNoteEditorRef.value?.focus()
}

const composeButtonText = computed(() => {
  const sel = selectedDate.value
  const now = new Date()
  const selDay = new Date(sel.getFullYear(), sel.getMonth(), sel.getDate())
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const labelDate = new Intl.DateTimeFormat(
    locale.value || undefined,
    { month: 'long', day: 'numeric' },
  ).format(sel)
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

// -------------------------------------------------------------
// 修改：Save New Note (支持离线)
// -------------------------------------------------------------
async function saveNewNote(content: string, weather: string | null) {
  if (!user.value || !content.trim())
    return

  const createdISO = buildCreatedAtForSelectedDay()

  // 1. 本地生成 UUID（代替 Supabase 生成）
  // crypto.randomUUID 现代浏览器都支持
  const tempId = globalThis.crypto ? globalThis.crypto.randomUUID() : `local-${Date.now()}`

  // 2. 构造“乐观”的笔记对象
  const optimisticNote = {
    id: tempId,
    user_id: user.value.id,
    content: content.trim(),
    created_at: createdISO,
    updated_at: createdISO,
    weather,
    // 标记它是本地生成的，有些业务可能需要区分
    // _isLocal: true
  }

  let finalNote = optimisticNote

  try {
    // 3. 尝试联网保存
    const { data, error } = await supabase
      .from('notes')
      .insert({
        // 注意：如果你数据库 id 是 uuid 且没有默认值，这里手动生成也是完全合法的
        id: tempId,
        user_id: user.value.id,
        content: content.trim(),
        created_at: createdISO,
        updated_at: createdISO,
        weather,
      })
      .select('*')
      .single()

    if (error)
      throw error
    finalNote = data // 成功，用服务器返回的覆盖
  }
  catch (e) {
    // 4. ❌ 失败（离线）：存入本地队列
    console.warn('联网保存新建笔记失败，转入离线队列:', e)
    await saveToOfflineQueue('INSERT', optimisticNote)
  }

  // 5. 更新本地状态 (这部分和原逻辑一样，只是用 optimisticNote)
  selectedDateNotes.value = [finalNote, ...selectedDateNotes.value]

  // 确保当天有点
  const key = dateKeyStr(selectedDate.value)
  if (!datesWithNotes.value.has(key)) {
    datesWithNotes.value.add(key)
    datesWithNotes.value = new Set(datesWithNotes.value)
    localStorage.setItem(
      CACHE_KEYS.CALENDAR_ALL_DATES,
      JSON.stringify(Array.from(datesWithNotes.value)),
    )
  }

  localStorage.setItem(
    getCalendarDateCacheKey(selectedDate.value),
    JSON.stringify(selectedDateNotes.value),
  )

  // 即使离线也 emit，让界面认为创建成功
  emit('created', finalNote)

  const draftKey = writingKey.value
  if (draftKey) {
    try {
      localStorage.removeItem(draftKey)
    }
    catch {}
  }

  isWriting.value = false
  newNoteContent.value = ''
  hideHeader.value = false
}
</script>

<template>
  <div ref="rootRef" class="calendar-view">
    <div v-show="!hideHeader" class="calendar-header" @click="handleHeaderClick">
      <h2>{{ t('notes.calendar.title') }}</h2>
      <button class="close-btn" @click.stop="emit('close')">×</button>
    </div>

    <!-- ✅ 新增：非滚动区域，包含「日历 + 写某天笔记按钮」 -->
    <div>
      <!-- 日历：从 scrollBodyRef 里搬出来，结构和 v-show 完全不变 -->
      <div v-show="!isWriting && !isEditingExisting" class="calendar-container">
        <Calendar
          is-expanded
          :attributes="attributes"
          :is-dark="isDark"
          @dayclick="day => fetchNotesForDate(day.date)"
        >
          <!-- 用自定义格式替换原来的 title -->
          <template #header-title="{ title }">
            <span class="calendar-nav-title">
              {{ formatCalendarHeaderTitle(title) }}
            </span>
          </template>
        </Calendar>
      </div>

      <!-- 写某天笔记按钮：也从 scrollBodyRef 里搬出来，样式 / 逻辑不变 -->
      <div class="notes-for-day-container">
        <!-- 工具行：写笔记按钮 -->
        <div v-if="!isWriting && !isEditingExisting" class="compose-row">
          <button class="compose-btn" @click="startWriting">
            {{ composeButtonText }}
          </button>
        </div>
      </div>
    </div>

    <!-- ✅ 只让下面这一块滚动（笔记输入 + 列表） -->
    <div ref="scrollBodyRef" class="calendar-body">
      <div class="notes-for-day-container">
        <!-- 轻量输入框（显示时隐藏上面的日历） -->
        <div v-if="isWriting" class="inline-editor">
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
            :clear-draft-on-save="false"
            :enable-scroll-push="true"
            @save="saveNewNote"
            @cancel="cancelWriting"
            @focus="onEditorFocus"
            @blur="() => {}"
          />
        </div>

        <!-- 编辑已有笔记（直接在日历内） -->
        <div v-if="isEditingExisting" class="inline-editor">
          <NoteEditor
            ref="editNoteEditorRef"
            v-model="editContent"
            :is-editing="true"
            :note-id="editingNote.id" :is-loading="false"
            :max-note-length="20000"
            :placeholder="t('notes.calendar.placeholder_edit')"
            :all-tags="allTags"
            :tag-counts="tagCounts"
            :enable-drafts="true"

            :clear-draft-on-save="false"
            :enable-scroll-push="true"
            @save="saveExistingNote"
            @cancel="cancelEditExisting"
            @focus="onEditorFocus"
            @blur="() => {}"
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
              @date-updated="(newNote) => handleDateUpdated(newNote)"
              @set-date="(note) => emit('setDate', note)"
            />
          </div>
        </div>

        <div v-else class="no-notes-text">
          {{ t('notes.calendar.no_notes_for_day') }}
        </div>
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
   /* 关键：整体让出顶部/底部安全区 */
   padding-top: var(--safe-top);
   padding-bottom: var(--safe-bottom);
}
.dark .calendar-view {
  background: #1e1e1e;
  color: #f0f0f0;
}
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
.dark .calendar-header {
  border-bottom-color: #374151;
}
.calendar-header h2 {
  font-size: 18px;
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

/* 新建：NoteEditor 根节点没有 .editing-viewport */
:deep(.inline-editor .note-editor-reborn:not(.editing-viewport) .editor-textarea) {
  max-height: 56vh !important;
}

/* 编辑：NoteEditor 根节点带有 .editing-viewport */
:deep(.inline-editor .note-editor-reborn.editing-viewport .editor-textarea) {
  max-height: 75dvh !important;
}

/* 日历顶部“十一月 2025”文字 */
.calendar-nav-title {
  font-weight: 600;
}

/* 暗色模式：强制文字为白色 */
.dark .calendar-view .calendar-nav-title {
  color: #f9fafb;
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

/* 覆盖 v-calendar 顶部年月标题的灰色/白色胶囊背景 */
.calendar-view .vc-title,
.calendar-view .vc-title-wrapper {
  background-color: transparent !important;
  box-shadow: none !important;
  border: none !important;
}

/* 写笔记按钮行 */
.compose-row {
  margin: 0 0 12px 0;
}
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

/* 输入框容器与间距 */
.inline-editor {
  margin-bottom: 16px;
}

/* 关键：当 isWriting=true 时，把上面的日历收起（只隐藏，不卸载） */
.calendar-container {
  transition: height 0.2s ease, opacity 0.2s ease;
}

/* 写在 <style>（不带 scoped 的那个）里面，放在最后就行 */

/* 去掉所有导航标题的灰色背景（含年份弹层中间的年份按钮） */
.vc-nav-title {
  background-color: transparent !important;
  box-shadow: none !important;
}

/* 年份选择弹层里的年份按钮再补一刀，防止被更具体的选择器盖回去 */
.vc-nav-popover .vc-nav-title {
  background-color: transparent !important;
  box-shadow: none !important;
}

/* 暗色模式下让标题/年份保持白色 */
.dark .vc-nav-title {
  color: #f9fafb !important;
}

/* 日历顶部标题（如：2025年11月 / November 2025）调大字号 */
.calendar-nav-title {
  font-weight: 600;
  font-size: 16px;     /* ← 原来约 16px，调大一些 */
  line-height: 1.3;    /* 更加居中对齐 */
}

/* 深色模式保持一致 */
.dark .calendar-nav-title {
  color: #f9fafb;
  font-size: 16px;
}
</style>
