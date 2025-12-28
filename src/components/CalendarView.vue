<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
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

const props = defineProps({
  // 👇 新增这一行：接收父组件传来的颜色，默认绿色
  themeColor: { type: String, default: '#00b386' },
})
const emit = defineEmits(['close', 'editNote', 'copy', 'pin', 'delete', 'setDate', 'created', 'updated', 'favorite'])
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

// --- 控制日历展开/收起的状态 ---
const isExpanded = ref(false)
const calendarRef = ref<any>(null)

watch(isExpanded, async (val) => {
  if (!val) {
    await nextTick()
    calendarRef.value?.move(selectedDate.value)
  }
})

// ==========================================
// ✅ 重构：月度统计逻辑 (缓存优先 + 全量校准)
// ==========================================
const monthlyStats = ref({ days: 0, count: 0, chars: 0 })

// 1. 通用分页拉取函数 (解决单次请求 1000 条限制)
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

// 2. 获取统计缓存 Key
function getStatsStorageKey(date: Date, userId: string) {
  const y = date.getFullYear()
  const m = date.getMonth() // 0-11
  return `calendar_stats_${userId}_m_${y}_${m}`
}

// 3. 核心统计函数
async function fetchMonthlyStats(date: Date) {
  if (!user.value)
    return

  const storageKey = getStatsStorageKey(date, user.value.id)

  // A. 优先读取缓存 (UI 立即响应)
  const cachedJson = localStorage.getItem(storageKey)
  if (cachedJson) {
    try {
      const cached = JSON.parse(cachedJson)
      // 仅当内存中的数据为空或与缓存不同时才赋值，避免闪烁
      // 这里简单处理：直接赋值让 UI 先显示缓存值
      monthlyStats.value = cached
    }
    catch (e) {}
  }
  else {
    monthlyStats.value = { days: 0, count: 0, chars: 0 }
  }

  // B. 联网静默更新 (Source of Truth)
  if (!navigator.onLine)
    return

  try {
    const year = date.getFullYear()
    const month = date.getMonth()
    const startDate = new Date(year, month, 1, 0, 0, 0, 0)
    const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999)

    // 构建查询：只查 content 和 created_at
    const query = supabase
      .from('notes')
      .select('content, created_at')
      .eq('user_id', user.value.id)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())

    // 使用分页拉取全量数据
    const notes = await fetchAllData(query)

    // 重新计算统计
    const count = notes.length
    const chars = notes.reduce((sum, n) => sum + (n.content?.length || 0), 0)
    const uniqueDays = new Set(notes.map(n => toDateKeyStrFromISO(n.created_at))).size

    const newData = { days: uniqueDays, count, chars }

    // C. 对比数据，有变化才更新 UI 和缓存
    if (
      newData.days !== monthlyStats.value.days
      || newData.count !== monthlyStats.value.count
      || newData.chars !== monthlyStats.value.chars
    )
      monthlyStats.value = newData

    // 始终更新缓存，保持新鲜
    localStorage.setItem(storageKey, JSON.stringify(newData))
  }
  catch (e) {
    console.warn('[Calendar] 统计更新失败:', e)
  }
}

function onCalendarMove(pages: any[]) {
  if (!pages || !pages.length)
    return

  const page = pages[0]
  const viewDate = new Date(page.year, page.month - 1, 1)
  fetchMonthlyStats(viewDate)
}

const isWriting = ref(false)
const newNoteContent = ref('')

const writingKey = computed(() => {
  const currentKeyStr = dateKeyStr(selectedDate.value)
  const todayKeyStr = dateKeyStr(new Date())
  if (currentKeyStr === todayKeyStr)
    return 'new_note_content_draft'

  return `calendar_draft_${currentKeyStr}`
})

async function saveToOfflineQueue(action: 'INSERT' | 'UPDATE', note: any) {
  try {
    if (action === 'INSERT') {
      await queuePendingNote(note)
    }
    else if (action === 'UPDATE') {
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
      return

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

// ✅ 修改：保存后直接重新拉取统计，而非手动计算 diff
async function saveExistingNote(content: string) {
  if (!user.value || !editingNote.value)
    return

  const id = editingNote.value.id
  const trimmed = (content || '').trim()
  if (!trimmed)
    return

  const nowISO = new Date().toISOString()
  const optimisticNote = {
    ...editingNote.value,
    content: trimmed,
    updated_at: nowISO,
  }

  let finalNote = optimisticNote

  try {
    const { data, error } = await supabase
      .from('notes')
      .update({ content: trimmed, updated_at: nowISO })
      .eq('id', id)
      .eq('user_id', user.value.id)
      .select('*')
      .single()

    if (error)
      throw error

    finalNote = data

    // 手动更新本地同步时间戳，防止触发自动同步导致数据被覆盖
    if (finalNote.updated_at) {
      const noteTs = new Date(finalNote.updated_at).getTime()
      const currentLastSync = Number(localStorage.getItem(CAL_LAST_SYNC_TS) || '0')
      if (noteTs > currentLastSync)
        localStorage.setItem(CAL_LAST_SYNC_TS, String(noteTs))
    }
  }
  catch (e) {
    console.warn('联网保存失败，转入离线队列:', e)
    await saveToOfflineQueue('UPDATE', optimisticNote)
  }

  selectedDateNotes.value = selectedDateNotes.value.map(n => (n.id === id ? finalNote : n))

  localStorage.setItem(
    getCalendarDateCacheKey(selectedDate.value),
    JSON.stringify(selectedDateNotes.value),
  )
  emit('updated', finalNote)

  // ✅ 核心修改：保存成功后，直接重新拉取月度统计，确保绝对准确
  await fetchMonthlyStats(selectedDate.value)

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
function handleFavorite(note: any) {
  emit('favorite', note)
}

async function handleDelete(noteId: string) {
  emit('delete', noteId)
}

// ✅ 修改：删除后直接重新拉取统计
async function commitDelete(noteId: string) {
  // 1. 从当前显示的列表中移除
  selectedDateNotes.value = selectedDateNotes.value.filter(n => n.id !== noteId)

  // 2. 更新本地缓存
  const dayCacheKey = getCalendarDateCacheKey(selectedDate.value)
  if (selectedDateNotes.value.length > 0)
    localStorage.setItem(dayCacheKey, JSON.stringify(selectedDateNotes.value))
  else
    localStorage.removeItem(dayCacheKey)

  // 3. 更新圆点状态
  refreshDotAfterDelete()

  // 4. ✅ 核心修改：重新拉取月度统计 (自动计算条数减一、字符数减少)
  await fetchMonthlyStats(selectedDate.value)

  // 5. 清除同步标记
  localStorage.removeItem(CAL_LAST_TOTAL)
  localStorage.removeItem(CAL_LAST_SYNC_TS)
}

function commitUpdate(updatedNote: any) {
  // 1. 在当前显示的列表中查找该笔记
  const index = selectedDateNotes.value.findIndex(n => n.id === updatedNote.id)

  if (index !== -1) {
    // 2. 替换为新数据
    selectedDateNotes.value[index] = { ...selectedDateNotes.value[index], ...updatedNote }

    // 触发响应式更新
    selectedDateNotes.value = [...selectedDateNotes.value]

    // 3. 更新本地缓存
    const dayCacheKey = getCalendarDateCacheKey(selectedDate.value)
    localStorage.setItem(dayCacheKey, JSON.stringify(selectedDateNotes.value))
  }
}

async function handleDateUpdated(updatedNote: any) {
  const currentKey = dateKeyStr(selectedDate.value)
  const currentCacheKey = getCalendarDateCacheKey(selectedDate.value)

  localStorage.removeItem(currentCacheKey)
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

  // ✅ 日期变更涉及跨天/跨月，强制刷新统计
  fetchMonthlyStats(selectedDate.value)
}

function handleHeaderClick() {
  if (scrollBodyRef.value)
    scrollBodyRef.value.scrollTo({ top: 0, behavior: 'smooth' })
}

async function toggleExpandInCalendar(noteId: string) {
  const isCollapsing = expandedNoteId.value === noteId
  expandedNoteId.value = isCollapsing ? null : noteId

  if (isCollapsing) {
    await nextTick()
    const el = document.getElementById(`cal-note-${noteId}`)
    if (el)
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
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

  const zhMonthMap: Record<string, string> = {
    january: '1',
    february: '2',
    march: '3',
    april: '4',
    may: '5',
    june: '6',
    july: '7',
    august: '8',
    september: '9',
    october: '10',
    november: '11',
    december: '12',
    jan: '1',
    feb: '2',
    mar: '3',
    apr: '4',
    jun: '6',
    jul: '7',
    aug: '8',
    sep: '9',
    oct: '10',
    nov: '11',
    dec: '12',
    一月: '1',
    二月: '2',
    三月: '3',
    四月: '4',
    五月: '5',
    六月: '6',
    七月: '7',
    八月: '8',
    九月: '9',
    十月: '10',
    十一月: '11',
    十二月: '12',
  }
  const normalizeMonth = (m: string) => {
    const lower = m.trim().toLowerCase()
    if (zhMonthMap[lower])
      return zhMonthMap[lower]

    const numMatch = lower.match(/^(\d{1,2})/)
    if (numMatch)
      return numMatch[1]

    return m.trim()
  }
  const formatPart = (m: string, y: string) => {
    return `${y}年${normalizeMonth(m)}月`
  }
  const isZh = String(locale.value || '').toLowerCase().startsWith('zh')
  if (!isZh)
    return rawTitle

  const crossYearMatch = rawTitle.match(/^(.*?)\s+(\d{4})\s*[-–]\s*(.*?)\s+(\d{4})$/)
  if (crossYearMatch) {
    const [_, m1, y1, m2, y2] = crossYearMatch
    return `${formatPart(m1, y1)} - ${formatPart(m2, y2)}`
  }
  const rangeMatch = rawTitle.match(/^(.*?)\s*[-–]\s*(.*?)\s+(\d{4})$/)
  if (rangeMatch) {
    const [_, m1, m2, year] = rangeMatch
    return `${year}年 ${normalizeMonth(m1)}月 - ${normalizeMonth(m2)}月`
  }
  const singleMatch = rawTitle.match(/^(.*?)\s+(\d{4})$/)
  if (singleMatch) {
    const [_, m, year] = singleMatch
    return formatPart(m, year)
  }
  return rawTitle
}

async function fetchAllNoteDatesFull() {
  if (!user.value)
    return

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

  // ✅ 切换日期时，获取当月统计 (带缓存)
  fetchMonthlyStats(date)

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

  if (!localStorage.getItem(cacheKey)) {
    isLoadingNotes.value = true
    try {
      if (!navigator.onLine) {
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
    else
      datesWithNotes.value.delete(key)

    datesWithNotes.value = new Set(datesWithNotes.value)
    localStorage.setItem(CACHE_KEYS.CALENDAR_ALL_DATES, JSON.stringify(Array.from(datesWithNotes.value)))
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
  localStorage.setItem(CACHE_KEYS.CALENDAR_ALL_DATES, JSON.stringify(Array.from(datesWithNotes.value)))
}

async function checkAndRefreshIncremental() {
  if (!user.value || !navigator.onLine)
    return

  const lastSync = Number(localStorage.getItem(CAL_LAST_SYNC_TS) || '0') || 0
  const lastTotal = Number(localStorage.getItem(CAL_LAST_TOTAL) || '0') || 0
  let serverTotal = 0
  try {
    const { count, error } = await supabase.from('notes').select('id', { count: 'exact', head: true }).eq('user_id', user.value.id)
    if (error)
      throw error

    serverTotal = count || 0
  }
  catch (e) {
    return
  }

  let serverMaxUpdatedAt = 0
  try {
    const { data, error } = await supabase.from('notes').select('updated_at').eq('user_id', user.value.id).order('updated_at', { ascending: false }).limit(1).single()
    if (error && (error as any).code !== 'PGRST116')
      throw error

    if (data?.updated_at)
      serverMaxUpdatedAt = new Date(data.updated_at).getTime()
  }
  catch (e) {
    return
  }

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
      const { data, error } = await supabase.from('notes').select('id, created_at, updated_at').eq('user_id', user.value.id).gt('updated_at', sinceISO)
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
      localStorage.setItem(CACHE_KEYS.CALENDAR_ALL_DATES, JSON.stringify(Array.from(datesWithNotes.value)))
    }
  }
  catch (e) {}
  await refetchSelectedDateAndMarkSync(serverTotal, serverMaxUpdatedAt)
}

// ✅ 修改：同步触发时，也调用新的统计刷新逻辑
async function refetchSelectedDateAndMarkSync(serverTotal: number, serverMaxUpdatedAt: number) {
  const dayCacheKey = getCalendarDateCacheKey(selectedDate.value)
  localStorage.removeItem(dayCacheKey)

  await fetchNotesForDate(selectedDate.value)

  // 强制刷新统计 (内部会自动去服务器拉最新数据)
  await fetchMonthlyStats(selectedDate.value)

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
  if (!hadCache && user.value)
    fetchAllNoteDatesFull().catch(() => {})

  const notesPromise = fetchNotesForDate(new Date())
  const countPromise = user.value
    ? supabase.from('notes').select('id', { count: 'exact', head: true }).eq('user_id', user.value.id)
    : Promise.resolve({ count: 0, error: null })
  await notesPromise
  try {
    const { count, error } = await countPromise
    if (!error && count !== null) {
      localStorage.setItem(CAL_LAST_TOTAL, String(count))
      localStorage.setItem(CAL_LAST_SYNC_TS, String(Date.now()))
    }
  }
  catch (e) {
    console.warn('预写入同步标记失败', e)
  }
  await checkAndRefreshIncremental()
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

function refreshData() {
  checkAndRefreshIncremental()
}

defineExpose({
  refreshData,
  commitDelete,
  commitUpdate,
})

// CalendarView.vue
async function startWriting() {
  newNoteContent.value = ''
  try {
    const targetKey = writingKey.value
    const raw = localStorage.getItem(targetKey)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.content === 'string')
        newNoteContent.value = parsed.content
    }
  }
  catch (e) {}
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

// ✅ 修改：新建笔记保存后，重新拉取统计
async function saveNewNote(content: string, weather: string | null) {
  if (!user.value || !content.trim())
    return

  const createdISO = buildCreatedAtForSelectedDay()
  const tempId = globalThis.crypto ? globalThis.crypto.randomUUID() : `local-${Date.now()}`

  const optimisticNote = {
    id: tempId,
    user_id: user.value.id,
    content: content.trim(),
    created_at: createdISO,
    updated_at: createdISO,
    weather,
  }

  let finalNote = optimisticNote

  try {
    const { data, error } = await supabase
      .from('notes')
      .insert({
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

    finalNote = data
    if (finalNote.updated_at) {
      const noteTs = new Date(finalNote.updated_at).getTime()
      const currentLastSync = Number(localStorage.getItem(CAL_LAST_SYNC_TS) || '0')
      if (noteTs > currentLastSync)
        localStorage.setItem(CAL_LAST_SYNC_TS, String(noteTs))
    }
  }
  catch (e) {
    console.warn('联网保存新建笔记失败，转入离线队列:', e)
    await saveToOfflineQueue('INSERT', optimisticNote)
  }

  selectedDateNotes.value = [finalNote, ...selectedDateNotes.value]

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

  emit('created', finalNote)

  // ✅ 核心修改：新建成功后，重新拉取月度统计
  await fetchMonthlyStats(selectedDate.value)

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
  <div
    ref="rootRef"
    class="calendar-view"
    :style="{
      '--theme-color': props.themeColor,
      '--theme-color-dark': `color-mix(in srgb, ${props.themeColor}, black 10%)`, // 按钮悬停色
      '--theme-text-dark': `color-mix(in srgb, ${props.themeColor}, white 20%)`, // 深色模式下的文字色
    }"
  >
    <div v-show="!hideHeader" class="calendar-header" @click="handleHeaderClick">
      <h2>{{ t('notes.calendar.title') }}</h2>
      <button class="close-btn" @click.stop="emit('close')">×</button>
    </div>

    <div>
      <div v-show="!isWriting && !isEditingExisting" class="calendar-container">
        <Calendar
          ref="calendarRef"
          is-expanded
          :view="isExpanded ? 'monthly' : 'weekly'"
          :attributes="attributes"
          :is-dark="isDark"
          @dayclick="day => fetchNotesForDate(day.date)"
          @did-move="onCalendarMove"
        >
          <template #header-title="{ title }">
            <div class="calendar-nav-wrapper">
              <span class="calendar-nav-title">
                {{ formatCalendarHeaderTitle(title) }}
              </span>
              <svg
                class="nav-caret"
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </template>
        </Calendar>

        <div class="expand-arrow-bar" :class="{ 'is-collapsed': !isExpanded }" @click="isExpanded = !isExpanded">
          <svg class="arrow-icon" :class="{ rotated: isExpanded }" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>

      <div class="notes-for-day-container">
        <div v-if="!isWriting && !isEditingExisting" class="compose-row">
          <button class="compose-btn" @click="startWriting">
            {{ composeButtonText }}
          </button>

          <i18n-t keypath="notes.calendar.month_stats" tag="span" class="monthly-stats">
            <template #days>
              <span class="stat-num">{{ monthlyStats.days }}</span>
            </template>
            <template #count>
              <span class="stat-num">{{ monthlyStats.count }}</span>
            </template>
            <template #chars>
              <span class="stat-num">{{ monthlyStats.chars }}</span>
            </template>
          </i18n-t>
        </div>
      </div>
    </div>

    <div ref="scrollBodyRef" class="calendar-body">
      <div class="notes-for-day-container">
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
            :enable-scroll-push="true"
            :clear-draft-on-save="true"
            @save="saveNewNote"
            @cancel="cancelWriting"
            @focus="onEditorFocus"
            @blur="() => {}"
          />
        </div>

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
            :clear-draft-on-save="true"
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
          <div
            v-for="note in selectedDateNotes"
            :id="`cal-note-${note.id}`"
            :key="note.id"
            class="note-wrapper"
            :class="{ 'collapsed-item-wrapper': expandedNoteId !== note.id }"
          >
            <NoteItem
              :note="note"
              :is-expanded="expandedNoteId === note.id"
              :dropdown-in-place="false"
              :show-internal-collapse-button="true"
              @toggle-expand="toggleExpandInCalendar"
              @edit="handleEdit"
              @copy="handleCopy"
              @pin="handlePin"
              @delete="handleDelete"
              @favorite="handleFavorite"
              @dblclick="handleEdit(note)"
              @date-updated="(newNote) => {
                handleDateUpdated(newNote)
                emit('updated', newNote)
              }"
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
  padding: 1rem 1rem 0 1rem;
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
  scroll-margin-top: 160px;
  transition: all 0.3s ease;
}

.collapsed-item-wrapper {
  max-height: 220px;
  overflow: hidden;
  mask-image: linear-gradient(to bottom, black 85%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, black 85%, transparent 100%);
}

.collapsed-item-wrapper :deep(.note-card) {
  padding-top: 1.5rem !important;
  padding-bottom: 3rem !important;
}

.notes-list > div:last-child {
  margin-bottom: 0;
}

/* =========================================================
   修复内嵌编辑器高度过小的问题 (最终版)
   ========================================================= */

/* 1. 外层容器：保持样式 */
:deep(.inline-editor .note-editor-reborn) {
  height: auto !important;
  min-height: 0 !important;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #e5e7eb;
}
.dark :deep(.inline-editor .note-editor-reborn) {
  border-color: #374151;
}

/* 2. 隐藏底部垫片 */
:deep(.inline-editor .editor-footer) {
  padding-bottom: 8px !important;
}

/* 3. 🔥 核心修复：新建和编辑统一使用大高度 */
:deep(.inline-editor .note-editor-reborn .editor-textarea) {
  height: auto !important;       /* 允许高度随内容稍微变化（如果有JS生效的话） */

  /* ✅ 按照你的思路：起步就是屏幕高度的 56%，既够大又不会被键盘顶飞 */
  min-height: 42dvh !important;

  /* 🔒 加一个最大高度保险，防止内容写了几千字后把头部标题栏顶出屏幕 */
  /* max-height: 80vh !important;*/
}

.calendar-nav-title {
  font-weight: 600;
}
.dark .calendar-view .calendar-nav-title {
  color: #f9fafb;
}

/* ✅ 新增：年份月份标题的容器，用于横向排列文字和图标 */
.calendar-nav-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px; /* 图标和文字之间的间距 */
  cursor: pointer;
  opacity: 0.9;
  transition: opacity 0.2s;
}

.calendar-nav-wrapper:hover {
  opacity: 1;
}

/* ✅ 新增：倒三角图标样式 */
.nav-caret {
  width: 14px;
  height: 14px;
  opacity: 0.6; /* 让图标稍微淡一点，不要喧宾夺主 */
  margin-top: 2px; /* 视觉微调，让它看起来更居中 */
}

/* 黑暗模式适配 */
.dark .nav-caret {
  opacity: 0.5;
}
.dark .calendar-nav-wrapper:hover .nav-caret {
  opacity: 0.8;
}

.expand-arrow-bar {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 0 0 8px 0;
  margin-top: -30px;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.2s, margin-top 0.2s ease;
  position: relative;
  z-index: 10;
}
.expand-arrow-bar.is-collapsed {
  margin-top: 0px;
}
.expand-arrow-bar:hover {
  opacity: 1;
}
.arrow-icon {
  width: 20px;
  height: 20px;
  color: #888;
  transition: transform 0.3s ease;
}
.dark .arrow-icon {
  color: #bbb;
}
.arrow-icon.rotated {
  transform: rotate(180deg);
}

/* ✅ 按钮和统计行样式优化 */
.compose-row {
  margin: 0 0 12px 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.compose-btn {
  /* 👇 保持你刚才修改的主题色 */
  background: var(--theme-color);
  color: #fff;
  border: none;
  border-radius: 6px;

  /* 👇 [修改]：加大内边距，恢复高度 */
  /* 原来是 6px 10px，太扁了；改为 10px 16px 会更像截图中的高度 */
  padding: 6px 8px;

  /* 👇 [修改]：稍微加大字号，看起来更协调 */
  font-size: 13px;

  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background-color 0.2s; /* 加上过渡更顺滑 */
}

.compose-btn:hover {
  /* 👇 保持深色悬停效果 */
  background: var(--theme-color-dark);
}
.inline-editor {
  margin-bottom: 16px;
}

/* ✅ 统计文字样式 */
.monthly-stats {
  font-size: 12px;
  color: #888;
  font-weight: 500;
  white-space: normal;
  text-align: right;
  line-height: 1.5;
  flex: 1;
}
.dark .monthly-stats {
  color: #6b7280;
}

.stat-num {
  /* 👇 修改：使用主题色 */
  color: var(--theme-color);
  font-weight: 600;
  margin: 0 -1px;
}
.dark .stat-num {
  /* 👇 修改：深色模式下稍微提亮一点 */
  color: var(--theme-text-dark);
}

/* 全局覆盖 */
.vc-nav-title {
  background-color: transparent !important;
  box-shadow: none !important;
}
.vc-nav-popover .vc-nav-title {
  background-color: transparent !important;
  box-shadow: none !important;
}
.dark .vc-nav-title {
  color: #f9fafb !important;
}
.calendar-nav-title {
  font-weight: 600;
  font-size: 16px;
  line-height: 1.3;
}
.dark .calendar-nav-title {
  color: #f9fafb;
  font-size: 16px;
}
</style>

<style>
/* 修复：强制移除日历头部“年份月份”和“左右箭头”的背景色及阴影 */
.calendar-view .vc-title,
.calendar-view .vc-title-wrapper,
.calendar-view .vc-arrow {  /* ✅ 新增了这一行，指向左右箭头按钮 */
  background-color: transparent !important;
  box-shadow: none !important;
  border: none !important;
}

/* 保持原有层级逻辑（防止弹窗被遮挡） */
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
