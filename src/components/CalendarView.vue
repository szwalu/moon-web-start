<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'

// 修改：导入 nextTick
import { useDark } from '@vueuse/core'
import { Calendar } from 'v-calendar'
import 'v-calendar/dist/style.css'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/utils/supabaseClient'
import { CACHE_KEYS, getCalendarDateCacheKey } from '@/utils/cacheKeys'
import NoteItem from '@/components/NoteItem.vue'

// ========== 轻量“日历内写笔记” ==========
import NoteEditor from '@/components/NoteEditor.vue'

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

const isWriting = ref(false) // 是否显示输入框
const newNoteContent = ref('') // v-model
const writingKey = computed(() => `calendar_draft_${dateKeyStr(selectedDate.value)}`)

const headerRef = ref<HTMLElement | null>(null)
const calendarContainerRef = ref<HTMLElement | null>(null)
const notesInnerRef = ref<HTMLElement | null>(null)
const notesScrollable = ref(false)
// --- 👇 新增：获取所有标签的函数 ---
async function fetchTagData() {
  if (!user.value)
    return
  try {
    // 1. 调用 get_unique_tags 获取所有不重复的标签列表
    const { data: tagsData, error: tagsError } = await supabase.rpc('get_unique_tags', {
      p_user_id: user.value.id,
    })
    if (tagsError)
      throw tagsError
    allTags.value = tagsData || []

    // 2. 调用 get_tag_counts 获取每个标签的使用次数
    const { data: countsData, error: countsError } = await supabase.rpc('get_tag_counts', {
      p_user_id: user.value.id,
    })
    if (countsError)
      throw countsError

    // 3. 将返回的数组 [{tag: '#a', cnt: 5}, ...] 转换为 NoteEditor 需要的对象格式 {'#a': 5, ...}
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
// --- 👆 新增函数结束 ---

const editingNote = ref<any | null>(null) // 当前正在编辑的已有笔记
const editContent = ref('') // 编辑框 v-model
const isEditingExisting = computed(() => !!editingNote.value)
const editDraftKey = computed(() => editingNote.value ? `calendar_edit_${editingNote.value.id}` : '')

const hideHeader = ref(false)

function onEditorFocus() {
  hideHeader.value = true
}

// 根容器 ref，限制只在日历弹层内部点击才触发
const rootRef = ref<HTMLElement | null>(null)

function onGlobalClickCapture(e: MouseEvent) {
  // 仅在编辑/写作态下处理
  if (!(isWriting.value || isEditingExisting.value))
    return

  const target = e.target as HTMLElement | null
  if (!target)
    return

  // 只处理发生在当前日历弹层内的点击
  const inThisOverlay = rootRef.value?.contains(target)
  if (!inThisOverlay)
    return

  // 若点击发生在编辑器容器内，则忽略（不显现页眉）
  const inInlineEditor = target.closest('.inline-editor')
  if (inInlineEditor)
    return

  // 其它位置（空白、列表、日历等）都显现页眉
  isWriting.value = false
  editingNote.value = null
  hideHeader.value = false
}

onMounted(() => {
  document.addEventListener('click', onGlobalClickCapture, true) // capture 阶段
})

onUnmounted(() => {
  document.removeEventListener('click', onGlobalClickCapture, true)
})

/** 本地元信息键：最近一次同步时间戳 & 总数 */
const CAL_LAST_SYNC_TS = 'calendar_last_sync_ts'
const CAL_LAST_TOTAL = 'calendar_last_total'

/** 把任意日期归一到“自然日”的 key（本地时区 YYYY-MM-DD） */
function dateKeyStr(d: Date) {
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  const mm = m < 10 ? `0${m}` : `${m}`
  const dd = day < 10 ? `0${day}` : `${day}`
  return `${y}-${mm}-${dd}`
}
function toDateKeyStrFromISO(iso: string) {
  return dateKeyStr(new Date(iso)) // new Date(iso) -> 本地时间，再取本地年月日
}

/** 从 YYYY-MM-DD 还原为日期对象（100%稳定、无时差） */
function dateFromKeyStr(key: string) {
  const [y, m, d] = key.split('-').map(n => Number(n))
  return new Date(y, (m - 1), d)
}

/* ===================== 事件处理（逐行写法，避免 max-statements-per-line） ===================== */
// 修改：将函数变为 async 并添加聚焦逻辑
async function handleEdit(note: any) {
  editingNote.value = note
  editContent.value = note?.content || ''
  isWriting.value = false
  expandedNoteId.value = null
  hideHeader.value = true
  if (scrollBodyRef.value)
    scrollBodyRef.value.scrollTo({ top: 0, behavior: 'smooth' })

  // 新增：等待 DOM 更新后，聚焦编辑器
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

  // 1) 从当前列表移除
  selectedDateNotes.value = selectedDateNotes.value.filter(n => n.id !== noteId)

  // 2) 同步当天缓存：空则删除缓存，不空则覆盖
  const dayCacheKey = getCalendarDateCacheKey(selectedDate.value)
  if (selectedDateNotes.value.length > 0)
    localStorage.setItem(dayCacheKey, JSON.stringify(selectedDateNotes.value))
  else
    localStorage.removeItem(dayCacheKey)

  // 3) 重新校准小蓝点
  refreshDotAfterDelete()
  await updateNotesLayoutAndScroll()
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
  const attrs: any[] = []

  // ① 有笔记的日期（小蓝点）
  for (const key of datesWithNotes.value) {
    attrs.push({
      key: `note-${key}`,
      dot: true,
      dates: dateFromKeyStr(key),
    })
  }

  // ② 今天的蓝色圆框
  const today = new Date()
  attrs.push({
    key: 'today-highlight',
    dates: today,
    highlight: {
      color: 'blue', // 蓝色
      fillMode: 'outline', // 空心圆框
      contentClass: 'today-outline', // 额外 class（可选）
    },
  })

  return attrs
})

// 把「十一月 2025」转成「2025年11月」
function formatCalendarHeaderTitle(rawTitle: string) {
  if (!rawTitle)
    return rawTitle

  const parts = rawTitle.split(' ')
  if (parts.length !== 2)
    return rawTitle

  const [monthText, yearText] = parts
  if (!/^\d{4}$/.test(yearText))
    return rawTitle

  // 支持把“十一月 2025”解析出月份数字
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
    十二月: 12,
  }

  const monthNum = zhMonthMap[monthText]
  if (!monthNum)
    return rawTitle

  const yearNum = Number(yearText)
  const d = new Date(yearNum, monthNum - 1, 1)
  const lang = String(locale.value || '').toLowerCase()

  // 中文：固定成“2025年11月”
  if (lang.startsWith('zh'))
    return `${yearText}年${monthNum}月`

  // 非中文：用当前语言格式化（英文就是“November 2025”）
  try {
    return new Intl.DateTimeFormat(
      lang || undefined,
      { year: 'numeric', month: 'long' },
    ).format(d)
  }
  catch {
    return rawTitle
  }
}

/* ===================== 全量：获取所有有笔记的日期集合（分页） ===================== */
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
      .select('created_at') // 只取需要的列
      .eq('user_id', user.value.id)
      .order('created_at', { ascending: false })
      .range(from, to) // ✅ 分页

    if (error)
      throw error

    ;(data || []).forEach((n) => {
      acc.add(toDateKeyStrFromISO(n.created_at))
    })

    if (!data || data.length < PAGE)
      break // 最后一页
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

    // 迁移：如果发现不是 YYYY-MM-DD，就尝试解析并转成 YYYY-MM-DD
    const normalized = arr.map((s) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(s))
        return s // 已是新格式
      const d = new Date(s) // 旧格式（toDateString）尽力解析
      if (Number.isNaN(d.getTime()))
        return s // 保底：解析失败就原样返回（很少见）
      return dateKeyStr(d)
    })

    datesWithNotes.value = new Set(normalized)

    // 把迁移后的写回去，统一成新格式
    localStorage.setItem(CACHE_KEYS.CALENDAR_ALL_DATES, JSON.stringify(normalized))
    return true
  }
  catch {
    localStorage.removeItem(CACHE_KEYS.CALENDAR_ALL_DATES)
    return false
  }
}

async function saveExistingNote(content: string /* , _weather: string | null */) {
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

    // 本地列表就地替换
    selectedDateNotes.value = selectedDateNotes.value.map(n => (n.id === id ? data : n))

    // 刷新当天缓存
    localStorage.setItem(
      getCalendarDateCacheKey(selectedDate.value),
      JSON.stringify(selectedDateNotes.value),
    )
    emit('updated', data)
  }
  catch (e) {
    console.error('更新笔记失败：', e)
    return // ❌ 更新失败：不清草稿，也不关闭编辑器
  }

  // ✅ 保存成功：清除这一条的“编辑草稿”
  const draftKey = editDraftKey.value
  if (draftKey) {
    try {
      localStorage.removeItem(draftKey)
    }
    catch {
      // 忽略本地错误
    }
  }

  // ✅ 然后再退出编辑器
  editingNote.value = null
  editContent.value = ''
  hideHeader.value = false
}

function cancelEditExisting() {
  editingNote.value = null
  editContent.value = ''
  hideHeader.value = false
}

/* ===================== 获取某日笔记：优先读缓存，缺失再拉取 ===================== */
// 用这个新函数完整替换掉旧的 fetchNotesForDate 函数
async function fetchNotesForDate(date: Date) {
  if (!user.value)
    return

  selectedDate.value = date
  expandedNoteId.value = null
  const cacheKey = getCalendarDateCacheKey(date)

  // --- 开始重写逻辑 ---

  // 阶段一：获取当天的笔记，优先用缓存
  const cachedData = localStorage.getItem(cacheKey)
  if (cachedData) {
    try {
      selectedDateNotes.value = JSON.parse(cachedData)
    }
    catch {
      localStorage.removeItem(cacheKey) // 清除无效缓存，以便后续从网络获取
    }
  }

  // 如果缓存不存在或无效，则从网络获取
  if (!localStorage.getItem(cacheKey)) {
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
      selectedDateNotes.value = [] // 失败时确保列表为空
    }
    finally {
      isLoadingNotes.value = false
    }
  }

  // 阶段二：【核心修正】在笔记列表确定后，无论来源是哪，都强制校准小蓝点
  const key = dateKeyStr(date)
  const hasNotes = selectedDateNotes.value.length > 0
  const hasDot = datesWithNotes.value.has(key)

  // 如果笔记状态和蓝点状态不一致，则进行修正
  if (hasNotes !== hasDot) {
    if (hasNotes)
      datesWithNotes.value.add(key)
    else
      datesWithNotes.value.delete(key)

    // 触发响应式更新，并更新总缓存
    datesWithNotes.value = new Set(datesWithNotes.value)
    localStorage.setItem(
      CACHE_KEYS.CALENDAR_ALL_DATES,
      JSON.stringify(Array.from(datesWithNotes.value)),
    )
  }
  // --- 结束重写逻辑 ---
  await updateNotesLayoutAndScroll()
}

async function updateNotesLayoutAndScroll() {
  await nextTick()

  const root = rootRef.value
  const headerEl = headerRef.value
  const calEl = calendarContainerRef.value
  const outer = scrollBodyRef.value // 笔记滚动容器
  const inner = notesInnerRef.value // 笔记真实内容

  if (!root || !outer || !inner)
    return

  const headerH = headerEl?.offsetHeight ?? 0
  // 只在「非写作/非编辑」时才算日历高度；写作时你本来就把日历收起来
  const calH = (!isWriting.value && !isEditingExisting.value && calEl)
    ? calEl.offsetHeight
    : 0

  const totalH = root.clientHeight
  const safeTop = 0 // 已经用 padding-top 让出了安全区，这里不用再减
  const safeBottom = 0 // 同上

  const available = totalH - safeTop - safeBottom - headerH - calH

  if (available > 0)
    outer.style.maxHeight = `${available}px`
  else
    outer.style.maxHeight = '0px'

  // 再根据内容高度决定要不要开滚动
  notesScrollable.value = inner.scrollHeight > outer.clientHeight + 1
}

async function updateNotesScrollAbility() {
  await nextTick()
  const el = scrollBodyRef.value
  if (!el)
    return

  // scrollHeight > clientHeight 说明内容“溢出”了，需要滚动
  notesScrollable.value = el.scrollHeight > el.clientHeight + 1
}

watch(
  () => ({
    len: selectedDateNotes.value.length,
    writing: isWriting.value,
    editing: isEditingExisting.value,
  }),
  () => {
    updateNotesScrollAbility()
  },
  { flush: 'post' },
)

/** 在删除后重新校准当前日期的蓝点状态 */
function refreshDotAfterDelete() {
  const key = dateKeyStr(selectedDate.value)
  const hasNotes = selectedDateNotes.value.length > 0
  const hasDot = datesWithNotes.value.has(key)

  if (hasNotes && !hasDot)
    datesWithNotes.value.add(key)
  else if (!hasNotes && hasDot)
    datesWithNotes.value.delete(key)

  // 替换新 Set 实例以触发响应式更新
  datesWithNotes.value = new Set(datesWithNotes.value)

  // 同步写回缓存
  localStorage.setItem(
    CACHE_KEYS.CALENDAR_ALL_DATES,
    JSON.stringify(Array.from(datesWithNotes.value)),
  )
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
      let added = false // ✅ 新增：记录是否真的往集合里加了新日期

      for (const row of (data || [])) {
        const key = toDateKeyStrFromISO(row.created_at)
        affectedDateKeys.add(key)
        if (!datesWithNotes.value.has(key)) {
          datesWithNotes.value.add(key)
          added = true
        }
      }

      // ✅ 关键：替换成一个新的 Set 实例，触发 Vue 响应
      if (added)
        datesWithNotes.value = new Set(datesWithNotes.value)

      // 清理这些日期的日缓存（使用本地无歧义还原）
      affectedDateKeys.forEach((keyStr) => {
        const partsDate = dateFromKeyStr(keyStr) // ✅ 本地时区安全
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

// 把这个函数恢复成下面的样子
async function refetchSelectedDateAndMarkSync(serverTotal: number, serverMaxUpdatedAt: number) {
  // 先强制失效“选中日期”的本地缓存，避免读到过期数据
  const dayCacheKey = getCalendarDateCacheKey(selectedDate.value)
  localStorage.removeItem(dayCacheKey)

  await fetchNotesForDate(selectedDate.value, true)
  localStorage.setItem(CAL_LAST_TOTAL, String(serverTotal))
  localStorage.setItem(CAL_LAST_SYNC_TS, String(serverMaxUpdatedAt || Date.now()))
}
/**
 * 当页面从后台切回前台时，主动触发一次增量刷新检查。
 * 这解决了在外部（如主页）删除了笔记后，回到日历视图数据不更新的问题。
 */
function handleVisibilityChange() {
  if (document.visibilityState === 'visible')
    checkAndRefreshIncremental()
}

/* ===================== 生命周期（先缓存再校验） ===================== */
onMounted(async () => {
  fetchTagData()
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
  await checkAndRefreshIncremental()
  await updateNotesLayoutAndScroll()

  // 在组件挂载时，添加可见性变化的事件监听器
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

// 在组件卸载时，清理事件监听器，防止内存泄漏
onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})

/* ===================== 暴露方法：供父组件在主页修改后主动刷新 ===================== */
function refreshData() {
  checkAndRefreshIncremental()
}
defineExpose({ refreshData })

// 打开输入框（并让列表滚回顶部）
// 修改：将函数变为 async 并添加聚焦逻辑
async function startWriting() {
  isWriting.value = true
  hideHeader.value = true
  if (scrollBodyRef.value)
    scrollBodyRef.value.scrollTo({ top: 0, behavior: 'smooth' })

  // 新增：等待 DOM 更新后，聚焦编辑器
  await nextTick()
  newNoteEditorRef.value?.focus()
}

// ✅ 计算按钮文字（今日前→补写，今日/未来→写）
const composeButtonText = computed(() => {
  const sel = selectedDate.value
  const now = new Date()

  const selDay = new Date(sel.getFullYear(), sel.getMonth(), sel.getDate())
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  // ✅ 使用当前语言自动本地化“月 日”
  const labelDate = new Intl.DateTimeFormat(
    // locale.value 可能是 'en', 'zh-CN', 'ja', ...；为空时交给系统默认
    locale.value || undefined,
    { month: 'long', day: 'numeric' },
  ).format(sel)

  if (selDay < today)
    return t('notes.calendar.compose_backfill', { date: labelDate })
  return t('notes.calendar.compose_write', { date: labelDate })
})

// 退出输入（不清草稿）
function cancelWriting() {
  isWriting.value = false
  hideHeader.value = false
}

// 把“日历选中的自然日 + 当前时分秒”合成 created_at
function buildCreatedAtForSelectedDay(): string {
  const day = new Date(selectedDate.value) // 自然日
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
    return // ❌ 保存失败：不清草稿，退出函数
  }

  // 1) 立即插入到当天列表（置顶）
  selectedDateNotes.value = [data, ...selectedDateNotes.value]

  // 2) 小蓝点：确保当天有点
  const key = dateKeyStr(selectedDate.value)
  if (!datesWithNotes.value.has(key)) {
    datesWithNotes.value.add(key)
    datesWithNotes.value = new Set(datesWithNotes.value)
    localStorage.setItem(
      CACHE_KEYS.CALENDAR_ALL_DATES,
      JSON.stringify(Array.from(datesWithNotes.value)),
    )
  }

  // 3) 刷新当天缓存
  localStorage.setItem(
    getCalendarDateCacheKey(selectedDate.value),
    JSON.stringify(selectedDateNotes.value),
  )
  emit('created', data)

  // ✅ 4) 保存成功后，手动清除“新建草稿”
  const draftKey = writingKey.value
  if (draftKey) {
    try {
      localStorage.removeItem(draftKey)
    }
    catch {
      // 本地存储异常忽略即可
    }
  }

  // 5) 关输入框 & 清空当前 v-model
  isWriting.value = false
  newNoteContent.value = ''
  hideHeader.value = false
  await updateNotesLayoutAndScroll()
}
</script>

<template>
  <div ref="rootRef" class="calendar-view">
    <div v-show="!hideHeader" ref="headerRef" class="calendar-header" @click="handleHeaderClick">
      <h2>{{ t('notes.calendar.title') }}</h2>
      <button class="close-btn" @click.stop="emit('close')">×</button>
    </div>
    <div class="calendar-body">
      <!-- 上半：日历，固定不滚动 -->
      <div v-show="!isWriting && !isEditingExisting" ref="calendarContainerRef" class="calendar-container">
        <Calendar
          is-expanded
          :attributes="attributes"
          :is-dark="isDark"
          @dayclick="day => fetchNotesForDate(day.date)"
        >
          <template #header-title="{ title }">
            <span class="calendar-nav-title">
              {{ formatCalendarHeaderTitle(title) }}
            </span>
          </template>
        </Calendar>
      </div>

      <!-- 下半：笔记区域，单独滚动 -->
      <div
        ref="scrollBodyRef"
        class="notes-scroll" :class="[{ 'notes-scroll--scrollable': notesScrollable }]"
      >
        <div ref="notesInnerRef" class="notes-for-day-container">
          <!-- 工具行：写笔记按钮 -->
          <div v-if="!isWriting && !isEditingExisting" class="compose-row">
            <button class="compose-btn" @click="startWriting">
              {{ composeButtonText }}
            </button>
          </div>

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

          <!-- 编辑已有笔记 -->
          <div v-if="isEditingExisting" class="inline-editor">
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
                @date-updated="handleDateUpdated"
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
  position: relative;
  display: flex;
  flex-direction: column;
}

/* 新增：只让笔记区域滚动 */
/* 只负责占位，不默认滚动 */
.notes-scroll {
 overflow-y: hidden;
}

/* 当内容超过容器高度时，才允许滚动 */
.notes-scroll--scrollable {
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
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
