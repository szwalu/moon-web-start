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
// ===== 写作 / 编辑状态（上移，避免在声明前被引用）=====
const isWriting = ref(false)
const newNoteContent = ref('')
const writingKey = computed(() => `calendar_draft_${dateKeyStr(selectedDate.value)}`)

const editingNote = ref<any | null>(null)
const editContent = ref('')
const isEditingExisting = computed(() => !!editingNote.value)
const editDraftKey = computed(() => (editingNote.value ? `calendar_edit_${editingNote.value.id}` : ''))

/* iOS 专用锚点：在行内编辑器底部放一个不可见元素，滚动它以确保“末行+键盘”可见 */
const anchorNewRef = ref<HTMLDivElement | null>(null)
const anchorEditRef = ref<HTMLDivElement | null>(null)

/* 行内编辑器容器：用于“末尾对齐 + 止抖计算” */
const wrapNewRef = ref<HTMLElement | null>(null)
const wrapEditRef = ref<HTMLElement | null>(null)

/* 当前行内编辑器在容器内可见（考虑键盘留白） */
function ensureInlineEditorVisible() {
  const container = scrollBodyRef.value
  if (!container)
    return
  const wrapEl = isWriting.value ? wrapNewRef.value : (isEditingExisting.value ? wrapEditRef.value : null)
  if (!wrapEl)
    return

  const extraPadding = 16
  const pad = effectivePad(container)
  const effectiveViewH = Math.max(0, container.clientHeight - pad)
  const wrapBottom = wrapEl.offsetTop + wrapEl.offsetHeight
  const viewBottom = container.scrollTop + effectiveViewH - extraPadding
  if (wrapBottom > viewBottom) {
    const neededTop = wrapBottom - effectiveViewH + extraPadding
    const y = Math.max(0, neededTop)
    if (Math.abs(container.scrollTop - y) > 8)
      container.scrollTo({ top: y, behavior: 'auto' })
  }
}

const hideHeader = ref(false)
function onEditorFocus() {
  hideHeader.value = true
}

function onNewEditorFocus() {
  onEditorFocus()
  ensureInlineEditorVisible()
  nudgeAfterFocus()
}
function onEditEditorFocus() {
  onEditorFocus()
  ensureInlineEditorVisible()
  nudgeAfterFocus()
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

/* ====== 键盘底部安全区：iOS 止抖 + 锚点滚动 ====== */
const UA = typeof navigator !== 'undefined' ? navigator.userAgent : ''
const IS_ANDROID = /Android|Adr/i.test(UA)
const IS_IOS = /iPhone|iPad|iPod/i.test(UA)

/* 较温和的“额外留白”，并提高冷却时间减少临界抖动 */
const IOS_EXTRA = 128
const IOS_SMALL_DELTA = 18
const IOS_NUDGE_COOLDOWN_MS = 260

const bottomSafeRaw = ref(0)
const bottomSafeApplied = computed(() => {
  const v = bottomSafeRaw.value
  if (IS_IOS && v > 0)
    return v + IOS_EXTRA
  return v
})

function applyScrollPaddingBottom(px: number) {
  const el = scrollBodyRef.value
  if (!el)
    return
  const v = Math.max(0, px | 0)
  el.style.setProperty('--kb-pad', `${v}px`)
}

/* 有效补偿：把键盘高度计入可视高度，上限不超过视高 85% */
function effectivePad(el: HTMLElement) {
  const cap = Math.floor(el.clientHeight * 0.85)
  return Math.min(Math.max(0, bottomSafeApplied.value | 0), cap)
}

// 抽一个安全聚焦的小工具，避免同一行出现多个语句
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

/* 单次、最小必要的锚点滚动（非贴底，仅越界补滚，扣除键盘补偿） */
let lastNudgeKey = ''
function iosNudgeToAnchor() {
  const container = scrollBodyRef.value
  if (!container)
    return
  const anchor = isWriting.value ? anchorNewRef.value : anchorEditRef.value
  if (!anchor)
    return

  const pad = effectivePad(container)
  const viewTop = container.scrollTop
  const viewBottom = viewTop + Math.max(0, container.clientHeight - pad)
  const anchorTop = anchor.offsetTop

  // 只有明显越界才滚动，阈值 36px
  const LOWER_THR = 36
  const UPPER_THR = 36

  const lowerGap = anchorTop - (viewBottom - LOWER_THR)
  const upperGap = (viewTop + UPPER_THR) - anchorTop

  // 去重：同一锚点 + 同一视口底部，不重复滚动
  const key = `${isWriting.value ? 'w' : 'e'}#${anchorTop}|${viewBottom}`
  if (key === lastNudgeKey && lowerGap <= 0 && upperGap <= 0)
    return

  if (lowerGap > 0) {
    container.scrollBy({ top: lowerGap, behavior: 'auto' })
    lastNudgeKey = key
    return
  }
  if (upperGap > 0) {
    container.scrollBy({ top: -upperGap, behavior: 'auto' })
    lastNudgeKey = key
  }
}

let lastAndroidPushAt = 0
let lastAppliedSent = 0
let lastIosNudgeAt = 0
let iosNudgeQueued = false

function scheduleIosNudge() {
  if (!IS_IOS)
    return
  const now = Date.now()
  if (now - lastIosNudgeAt < IOS_NUDGE_COOLDOWN_MS)
    return
  if (iosNudgeQueued)
    return
  iosNudgeQueued = true
  requestAnimationFrame(() => {
    iosNudgeQueued = false
    lastIosNudgeAt = Date.now()
    iosNudgeToAnchor()
  })
}

function onBottomSafeChange(px: number) {
  const v = Math.max(0, Number(px) || 0)
  bottomSafeRaw.value = v

  const applied = bottomSafeApplied.value
  const deltaApplied = Math.abs(applied - lastAppliedSent)

  /* iOS：细小变化直接忽略，避免来回顶 */
  if (IS_IOS && lastAppliedSent > 0 && deltaApplied < IOS_SMALL_DELTA)
    return

  applyScrollPaddingBottom(applied)

  if (IS_IOS && applied > 0)
    scheduleIosNudge()

  const now = Date.now()
  const changedEnough = Math.abs(applied - lastAppliedSent) >= (IS_ANDROID ? 18 : 8)
  const timeOk = now - lastAndroidPushAt >= (IS_ANDROID ? 140 : 60)
  if (IS_ANDROID && applied > lastAppliedSent && changedEnough && timeOk) {
    const el = scrollBodyRef.value
    if (el) {
      const ratio = 1.4
      const cap = 360
      const delta = Math.min(Math.ceil((applied - lastAppliedSent) * ratio), cap)
      el.scrollBy({ top: delta, behavior: 'auto' })
      lastAndroidPushAt = now
    }
  }

  lastAppliedSent = applied

  // 键盘高度变化后：单帧合并一次 + 轻微延迟再一次
  ensureInlineEditorVisibleSoon()
  window.setTimeout(() => {
    ensureInlineEditorVisibleSoon()
  }, 120)
}

let _pendingEnsureVisible = false
function ensureInlineEditorVisibleSoon() {
  if (_pendingEnsureVisible)
    return
  _pendingEnsureVisible = true
  requestAnimationFrame(() => {
    _pendingEnsureVisible = false
    ensureInlineEditorVisible()
  })
}

/* 切换写作/编辑状态后，如已抬升则补一次 nudge */
watch([isWriting, isEditingExisting], () => {
  if (IS_IOS && bottomSafeApplied.value > 0)
    scheduleIosNudge()
})

function nudgeAfterFocus() {
  if (!IS_IOS)
    return
  scheduleIosNudge()
  window.setTimeout(() => {
    scheduleIosNudge()
  }, 120)
}

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

  if (scrollBodyRef.value)
    scrollBodyRef.value.scrollTo({ top: 0, behavior: 'smooth' })

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

  nudgeAfterFocus()
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
  if (scrollBodyRef.value)
    scrollBodyRef.value.scrollTo({ top: 0, behavior: 'smooth' })
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
  if (scrollBodyRef.value)
    scrollBodyRef.value.scrollTo({ top: 0, behavior: 'smooth' })
  await nextTick()
  ensureInlineEditorVisible()
  requestAnimationFrame(() => {
    ensureInlineEditorVisible()
  })
  window.setTimeout(() => {
    ensureInlineEditorVisible()
  }, 120)
  if (newNoteEditorRef.value)
    safeFocusEditor(newNoteEditorRef.value)
  nudgeAfterFocus()
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
</script>

<template>
  <div ref="rootRef" class="calendar-view">
    <div v-show="!hideHeader" class="calendar-header" @click="handleHeaderClick">
      <h2>{{ t('notes.calendar.title') }}</h2>
      <button class="close-btn" @click.stop="emit('close')">×</button>
    </div>

    <!-- 给滚动容器设置 scroll-padding-bottom，配合锚点滚动 -->
    <div
      ref="scrollBodyRef"
      class="calendar-body"
    >
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

        <!-- 新建态：锚点 + 尾部缓冲 -->
        <div
          v-if="isWriting"
          ref="wrapNewRef"
          class="inline-editor"
        >
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
            @blur="() => {}"
            @bottom-safe-change="onBottomSafeChange"
            @focus="onNewEditorFocus"
          />
          <div
            v-if="bottomSafeApplied"
            class="kb-spacer"
            :style="{ height: `${Math.min(bottomSafeApplied, 220)}px` }"
          />
          <div ref="anchorNewRef" class="kb-anchor" />
        </div>

        <!-- 编辑态：锚点 + 尾部缓冲 -->
        <div
          v-if="isEditingExisting"
          ref="wrapEditRef"
          class="inline-editor"
        >
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
            @blur="() => {}"
            @bottom-safe-change="onBottomSafeChange"
            @focus="onEditEditorFocus"
          />
          <div
            v-if="bottomSafeApplied"
            class="kb-spacer"
            :style="{ height: `${Math.min(bottomSafeApplied, 220)}px` }"
          />
          <div ref="anchorEditRef" class="kb-anchor" />
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

        <!-- 全局兜底 spacer（统一由 --kb-pad 控制高度） -->
        <div class="kb-spacer-global" style="height: calc(var(--kb-pad, 0px));" />
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
  scroll-padding-bottom: calc(var(--kb-pad, 0px) + 8px);
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

/* spacer 与锚点 */
.kb-spacer, .kb-spacer-global { width: 100%; pointer-events: none; }
.kb-anchor { width: 1px; height: 1px; margin-top: 0; }
</style>

<style>
.n-dialog__mask, .n-modal-mask { z-index: 6002 !important; }
.n-dialog, .n-dialog__container, .n-modal, .n-modal-container { z-index: 6003 !important; }
.n-message-container, .n-notification-container, .n-popover, .n-dropdown { z-index: 6004 !important; }

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

/* 输入框容器与间距 */
.inline-editor { margin-bottom: 16px; }

/* 隐藏/显示日历的过渡 */
.calendar-container { transition: height 0.2s ease, opacity 0.2s ease; }
</style>
