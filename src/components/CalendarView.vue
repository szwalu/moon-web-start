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

// --- ✅ 新增：控制日历展开/收起的状态 ---
const isExpanded = ref(false) // 默认为 false (周视图/收起)

// 2. 新增：定义日历组件的 ref
const calendarRef = ref<any>(null)

// 3. 新增：监听展开状态，收起时强制定位回选中日期
watch(isExpanded, async (val) => {
  if (!val) { // 当变为 false (收起) 时
    await nextTick()
    // 强制日历移动到当前选中的日期，从而显示正确的那一周
    calendarRef.value?.move(selectedDate.value)
  }
})

// --- ✅ 新增：本月统计数据状态 ---
const monthlyStats = ref({
  days: 0,
  count: 0,
  chars: 0,
})

// --- ✅ 新增：获取本月统计数据的函数 ---
async function fetchMonthlyStats(date: Date) {
  if (!user.value)
    return

  // 1. 计算当月的起止时间
  const year = date.getFullYear()
  const month = date.getMonth()
  // 月初：当月1号 00:00:00
  const startDate = new Date(year, month, 1, 0, 0, 0, 0)
  // 月末：下个月0号（即本月最后一天） 23:59:59
  const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999)

  try {
    // 2. 如果离线，暂时不显示或显示为0（也可以改为从localStorage遍历，但性能消耗较大，这里优先联网）
    if (!navigator.onLine) {
      // 也可以选择保持上一次的数据，或者归零
      return
    }

    // 3. 查询当月所有笔记的内容（为了计算字数）
    const { data, error } = await supabase
      .from('notes')
      .select('content, created_at')
      .eq('user_id', user.value.id)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())

    if (error)
      throw error

    // 4. 计算统计数据
    const notes = data || []

    // 计算天数：利用 Set 去重日期
    const uniqueDays = new Set(notes.map(n => toDateKeyStrFromISO(n.created_at))).size
    // 计算条数
    const count = notes.length
    // 计算字数：累加 content 长度
    const chars = notes.reduce((sum, n) => sum + (n.content?.length || 0), 0)

    monthlyStats.value = { days: uniqueDays, count, chars }
  }
  catch (e) {
    console.warn('[Calendar] 获取月度统计失败:', e)
  }
}

// ✅ 新增：监听日历翻页事件
function onCalendarMove(pages: any[]) {
  // pages 是 v-calendar 返回的当前视图数组，通常包含 month(1-12) 和 year
  if (!pages || !pages.length)
    return

  const page = pages[0]
  // page.month 是 1-based (1月是1)，但 Date() 构造函数月是 0-based (1月是0)
  // 我们构造该月1号的日期对象
  const viewDate = new Date(page.year, page.month - 1, 1)

  // 获取该可视月份的统计数据
  fetchMonthlyStats(viewDate)
}

const isWriting = ref(false)
const newNoteContent = ref('')
// CalendarView.vue

const writingKey = computed(() => {
  // 1. 获取日历选中的日期字符串 (如 2025-12-13)
  const currentKeyStr = dateKeyStr(selectedDate.value)
  // 2. 获取今天的日期字符串 (如 2025-12-13)
  const todayKeyStr = dateKeyStr(new Date())

  // ✅ 核心修改：如果是今天，强制使用你查到的主页 Key
  if (currentKeyStr === todayKeyStr)
    return 'new_note_content_draft'

  // 3. 如果是昨天或明天，保持原样 (calendar_draft_2025-xx-xx)
  return `calendar_draft_${currentKeyStr}`
})
// --- 👇 修改后的离线队列函数：复用主界面的同步机制 ---
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
  fetchMonthlyStats(selectedDate.value)
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
  fetchMonthlyStats(selectedDate.value)
  localStorage.removeItem(CAL_LAST_TOTAL)
  localStorage.removeItem(CAL_LAST_SYNC_TS)
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
}

function handleHeaderClick() {
  if (scrollBodyRef.value)
    scrollBodyRef.value.scrollTo({ top: 0, behavior: 'smooth' })
}

async function toggleExpandInCalendar(noteId: string) {
  const isCollapsing = expandedNoteId.value === noteId
  expandedNoteId.value = isCollapsing ? null : noteId

  // 如果是收起操作，手动修正滚动位置
  if (isCollapsing) {
    await nextTick()
    const el = document.getElementById(`cal-note-${noteId}`)
    if (el) {
      // block: 'nearest' 会尽量微调滚动条让元素可见
      // 如果想要更强烈的效果（比如回到顶部），可以用 block: 'center' 或 'start'
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
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

  // 1. 定义中文映射 (兼容 v-calendar 可能输出的中文或英文)
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
    // 容错：如果 v-calendar 已经输出了 "1月" 这种格式，我们去掉"月"字取数字，或者直接保留
  }

  // 辅助函数：尝试把 "December" 或 "12月" 统一转为 "12"
  // 如果无法转换（比如已经是数字或无法识别），则保留原样但不带"月"
  const normalizeMonth = (m: string) => {
    const lower = m.trim().toLowerCase()
    if (zhMonthMap[lower])
      return zhMonthMap[lower]
    // 尝试提取数字
    const numMatch = lower.match(/^(\d{1,2})/)
    if (numMatch)
      return numMatch[1]
    return m.trim()
  }

  // 辅助函数：格式化单个部分 "Month Year" -> "Year年Month月"
  const formatPart = (m: string, y: string) => {
    return `${y}年${normalizeMonth(m)}月`
  }

  // 检测是否是中文环境
  const isZh = String(locale.value || '').toLowerCase().startsWith('zh')
  if (!isZh)
    return rawTitle

  // --- 情况 A: 跨年范围 (例如: "12月 2025 - 1月 2026" 或 "Dec 2025 - Jan 2026") ---
  // 正则逻辑：(任意字符) (4位年份) (连接符) (任意字符) (4位年份)
  const crossYearMatch = rawTitle.match(/^(.*?)\s+(\d{4})\s*[-–]\s*(.*?)\s+(\d{4})$/)
  if (crossYearMatch) {
    const [_, m1, y1, m2, y2] = crossYearMatch
    // 修正：分别格式化两端
    return `${formatPart(m1, y1)} - ${formatPart(m2, y2)}`
  }

  // --- 情况 B: 同年范围 (例如: "11月 - 12月 2025" 或 "Nov - Dec 2025") ---
  // 正则逻辑：(任意字符) (连接符) (任意字符) (4位年份 结尾)
  const rangeMatch = rawTitle.match(/^(.*?)\s*[-–]\s*(.*?)\s+(\d{4})$/)
  if (rangeMatch) {
    const [_, m1, m2, year] = rangeMatch
    return `${year}年 ${normalizeMonth(m1)}月 - ${normalizeMonth(m2)}月`
  }

  // --- 情况 C: 单月 (例如: "12月 2025" 或 "December 2025") ---
  const singleMatch = rawTitle.match(/^(.*?)\s+(\d{4})$/)
  if (singleMatch) {
    const [_, m, year] = singleMatch
    return formatPart(m, year)
  }

  // 兜底
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

  // ❌ 之前这里你可能不小心写了两遍 if，导致括号不匹配
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
  // 1. 并行启动：获取圆点（不阻塞）、获取今日笔记（阻塞）、获取笔记总数（用于骗过同步检查）
  const hadCache = loadAllDatesFromCache()
  if (!hadCache && user.value)
    fetchAllNoteDatesFull().catch(() => {})

  // 发起获取笔记请求（为了尽快显示）
  const notesPromise = fetchNotesForDate(new Date())

  // ✅ 新增：并行发起一个获取总数的请求（为了解决闪烁）
  const countPromise = user.value
    ? supabase.from('notes').select('id', { count: 'exact', head: true }).eq('user_id', user.value.id)
    : Promise.resolve({ count: 0, error: null })

  // 2. 等待笔记加载完成并显示（用户此时看到了内容）
  await notesPromise

  // ✅ 3. 关键修复：在运行 checkAndRefreshIncremental 之前，手动写入同步标记
  // 这样后续的检查就会发现 (ServerTotal == LocalTotal)，从而跳过“删除缓存并重拉”的步骤
  try {
    const { count, error } = await countPromise
    if (!error && count !== null) {
      localStorage.setItem(CAL_LAST_TOTAL, String(count))
      // 写入当前时间戳，防止因时间戳落后触发增量更新
      localStorage.setItem(CAL_LAST_SYNC_TS, String(Date.now()))
    }
  }
  catch (e) {
    console.warn('预写入同步标记失败', e)
  }

  // 4. 最后再运行原本的增量检查（此时它会认为数据是最新的，静默结束，不会闪烁）
  await checkAndRefreshIncremental()

  document.addEventListener('visibilitychange', handleVisibilityChange)
})

function refreshData() {
  checkAndRefreshIncremental()
}
defineExpose({ refreshData })

// CalendarView.vue

async function startWriting() {
  // 1. 清空旧内容
  newNoteContent.value = ''

  // 2. 手动预读取草稿
  try {
    // 获取上面的 key (如果是今天，就是 'new_note_content_draft')
    const targetKey = writingKey.value

    // 直接读 LocalStorage
    const raw = localStorage.getItem(targetKey)

    if (raw) {
      const parsed = JSON.parse(raw)
      // 如果有内容，直接填进编辑器
      if (parsed && typeof parsed.content === 'string')
        newNoteContent.value = parsed.content
    }
  }
  catch (e) {
    // 忽略错误
  }

  // 3. 正常显示编辑器
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
  fetchMonthlyStats(selectedDate.value)
  const draftKey = writingKey.value
  if (draftKey) {
    // 之前可能在这里少复制了大括号
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
            <span class="calendar-nav-title">
              {{ formatCalendarHeaderTitle(title) }}
            </span>
          </template>
        </Calendar>

        <div class="expand-arrow-bar" :class="{ 'is-collapsed': !isExpanded }" @click="isExpanded = !isExpanded">
          <svg
            class="arrow-icon"
            :class="{ rotated: isExpanded }"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
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
            :clear-draft-on-save="false"
            :enable-scroll-push="true"
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
  padding: 1rem 1rem 0 1rem; /* 稍微减少底部 padding 留给箭头 */
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
  scroll-margin-top: 160px;
  transition: all 0.3s ease;
}

/* ✅ 1. 外层强制限高（解决空白问题的根本） */
.collapsed-item-wrapper {
  /* 限制整体高度，超出部分直接切掉 */
  max-height: 220px;
  overflow: hidden;

  /* 加上渐变遮罩，让底部边缘柔和一点 */
  mask-image: linear-gradient(to bottom, black 85%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, black 85%, transparent 100%);
}

/* ✅ 2. 内层关键修复：减少 Padding，把按钮“提”上来 */
/* 只有在收起状态下，才去压缩 NoteItem 的内边距 */
.collapsed-item-wrapper :deep(.note-card) {
  /* 原来是 4rem (64px)，改小一点，让内容和按钮更紧凑 */
  padding-top: 1.5rem !important;
  padding-bottom: 3rem !important;
  /* 这样按钮就不会被挤到 220px 以外了 */
}

.notes-list > div:last-child {
  margin-bottom: 0;
}

:deep(.inline-editor .note-editor-reborn:not(.editing-viewport) .editor-textarea) {
  max-height: 56vh !important;
}

:deep(.inline-editor .note-editor-reborn.editing-viewport .editor-textarea) {
  max-height: 75dvh !important;
}

.calendar-nav-title {
  font-weight: 600;
}
.dark .calendar-view .calendar-nav-title {
  color: #f9fafb;
}

/* ✅ 新增：底部展开箭头样式 */
.expand-arrow-bar {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 0 0 8px 0;

  /* 默认（展开时）保持紧凑，维持你满意的间隙 */
  margin-top: -30px;

  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.2s, margin-top 0.2s ease; /* 顺便加个 margin 动画，切换时更丝滑 */
  position: relative;
  z-index: 10;
}

/* ✅ 新增：收起状态下，取消负边距（或者设为 -2px 微调） */
.expand-arrow-bar.is-collapsed {
  margin-top: 0px; /* 这里数值越大，离日期越远。建议 -2px 或 0 */
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
/* 展开时箭头旋转 180 度 */
.arrow-icon.rotated {
  transform: rotate(180deg);
}
</style>

<style>
/* ...原有全局样式保持不变... */
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
.calendar-view .vc-title,
.calendar-view .vc-title-wrapper {
  background-color: transparent !important;
  box-shadow: none !important;
  border: none !important;
}
.compose-row {
  margin: 0 0 12px 0;
  display: flex;
  justify-content: space-between;
  align-items: center; /* 垂直居中，这样文字换行时按钮依然居中，或者改为 flex-end 底部对齐 */
}
.monthly-stats {
  font-size: 12px;
  color: #888;
  font-weight: 500;

  /* ✅ 修改点 1：允许换行 */
  white-space: normal;
  text-align: right; /* 多行时靠右对齐，视觉更整洁 */
  line-height: 0.8;  /* 增加行高，换行后不拥挤 */
  flex: 1;           /* 允许占据剩余空间，确保换行生效 */
}

/* 适配暗色模式下的文字基色 */
.dark .monthly-stats {
  color: #6b7280;
}
.stat-num {
  /* 浅色模式下的淡紫色 (比如 Indigo/Violet 色系) */
  color: #8b5cf6;
  font-weight: 600; /* 数字加粗一点点，更清晰 */
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; /* 可选：用等宽字体显示数字更有质感 */

}

/* 暗色模式下的淡紫色（需要更亮一点才看得清） */
.dark .stat-num {
  color: #a78bfa;
}

.compose-btn {
  background: #6366f1;
  color: #fff;
  border: none;
  border-radius: 6px; /* 圆角也可以稍微改小一点适配紧凑风格 */

  /* ✅ 修改点 1：减小内边距 (原来是 8px 12px) */
  padding: 6px 10px;

  /* ✅ 修改点 2：稍微减小字号 (原来是 14px) */
  font-size: 13px;

  cursor: pointer;

  /* ✅ 修改点 3：防止按钮被压缩变形，确保文字完整显示 */
  white-space: nowrap;
  flex-shrink: 0;
}

.compose-btn:hover {
  background: #4f46e5;
}
.calendar-container {
  transition: height 0.2s ease, opacity 0.2s ease;
}
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
