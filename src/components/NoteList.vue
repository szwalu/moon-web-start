<script setup lang="ts">
import { computed, defineExpose, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { throttle } from 'lodash-es'
import { useI18n } from 'vue-i18n'

import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import NoteItem from '@/components/NoteItem.vue'
import NoteEditor from '@/components/NoteEditor.vue'

const props = defineProps({
  notes: { type: Array as () => any[], required: true },
  isLoading: { type: Boolean, default: false },
  hasMore: { type: Boolean, default: true },
  isSelectionModeActive: { type: Boolean, default: false },
  selectedNoteIds: { type: Array as () => string[], default: () => [] },
  allTags: { type: Array as () => string[], default: () => [] },
  maxNoteLength: { type: Number, default: 5000 },
  searchQuery: { type: String, default: '' },
  bottomInset: { type: Number, default: 10 },
})
const emit = defineEmits([
  'loadMore',
  'updateNote',
  'deleteNote',
  'pinNote',
  'copyNote',
  'taskToggle',
  'toggleSelect',
  'dateUpdated',
  'scrolled',
  'editingStateChange',
  'monthHeaderClick',
  'favoriteNote',
])

// 记录“展开瞬间”的锚点，用于收起时恢复
const expandAnchor = ref<{ noteId: string | null; topOffset: number; scrollTop: number }>({
  noteId: null,
  topOffset: 0,
  scrollTop: 0,
})

const { t } = useI18n()

const scrollerRef = ref<InstanceType<typeof DynamicScroller> | null>(null)
const wrapperRef = ref<HTMLElement | null>(null)
const collapseBtnRef = ref<HTMLElement | null>(null)
const collapseVisible = ref(false)
const collapseStyle = ref<{ left: string; top: string }>({ left: '0px', top: '0px' })

const expandedNote = ref<string | null>(null)
const editingNoteId = ref<string | null>(null)
const editingNoteContent = ref('')
// ==== 顶置编辑框：状态 ====
const editingNoteTop = ref<any | null>(null) // 当前被编辑的笔记对象（顶置方式）
const editTopContent = ref('') // 顶置编辑框的内容
const isEditingTop = computed(() => !!editingNoteTop.value)
const editTopDraftKey = computed(() =>
  editingNoteTop.value ? `list_edit_${editingNoteTop.value.id}` : '',
)
const editTopEditorRef = ref<InstanceType<typeof NoteEditor> | null>(null)

const noteContainers = ref<Record<string, HTMLElement>>({})
const editReturnScrollTop = ref<number | null>(null)

// ---- 供 :ref 使用的辅助函数（仅记录 note 卡片） ----
function setNoteContainer(el: Element | null, id: string) {
  if (el) {
    const $el = el as HTMLElement
    $el.setAttribute('data-note-id', id)
    noteContainers.value[id] = $el
  }
  else {
    // 关键：当 el 为 null 时，必须从字典中移除
    delete noteContainers.value[id]
  }
}

// ==============================
// 月份头部（虚拟项）+ 悬浮月份条 逻辑（最小侵入）
// ==============================

interface MonthHeaderItem {
  type: 'month-header'
  id: string
  monthKey: string // "YYYY-MM"
  label: string // "YYYY年M月"
  vid: string // 新增：供虚拟列表使用的复合 key
}
type MixedNoteItem = any & { type: 'note'; vid: string }
type MixedItem = MonthHeaderItem | MixedNoteItem

function getMonthKeyAndLabel(note: any): { key: string; label: string } {
  const raw = note?.date || note?.created_at || note?.updated_at
  const d = raw ? new Date(raw) : new Date()
  const yyyy = d.getFullYear()
  const mm = d.getMonth() + 1
  const key = `${yyyy}-${String(mm).padStart(2, '0')}`
  const label = t('notes.list.month_label', { year: yyyy, month: mm })
  return { key, label }
}

/** 置顶判断（自适配常见字段） */
function _isPinned(n: any) {
  return !!(n?.pinned || n?.is_pinned || n?.pinned_at)
}

/* ========= 新增：统一去重 + 稳定排序的入口 normalizedNotes ========= */
function _ts(n: any) {
  const raw = n?.date || n?.created_at || n?.updated_at
  return raw ? new Date(raw).getTime() : 0
}

/** 统一入口：去重（按 id）、稳定排序（置顶优先，其次时间倒序） */
const normalizedNotes = computed<any[]>(() => {
  const seen = new Set<string>()
  const buf: any[] = []
  for (const n of props.notes) {
    if (!n || n.id == null)
      continue

    const id = String(n.id)
    if (!seen.has(id)) {
      seen.add(id)
      buf.push(n)
    }
    else {
      // 如出现重复 id（常见于乐观插入 + 服务端回流），保留“时间更新较新的那条”
      const idx = buf.findIndex(x => String(x.id) === id)
      if (idx >= 0 && _ts(n) >= _ts(buf[idx]))
        buf[idx] = n
    }
  }
  // 稳定排序：置顶优先；同组内按时间倒序
  return buf.sort((a, b) => {
    const pa = _isPinned(a) ? 0 : 1
    const pb = _isPinned(b) ? 0 : 1
    if (pa !== pb)
      return pa - pb

    return _ts(b) - _ts(a)
  })
})
/* ========================== 结束新增 ========================== */

/** 跳过置顶段，从第一条非置顶开始插入月份头 */
const mixedItems = computed<MixedItem[]>(() => {
  const out: MixedItem[] = []
  let lastKey = ''
  let inPinned = true

  for (const n of normalizedNotes.value) {
    if (inPinned && !_isPinned(n)) {
      inPinned = false
      const { key, label } = getMonthKeyAndLabel(n)
      out.push({ type: 'month-header', id: `hdr-${key}`, monthKey: key, label, vid: `h:${key}` })
      lastKey = key
      out.push({ ...n, type: 'note', vid: `n:${n.id}` } as MixedNoteItem)
      continue
    }
    if (inPinned) {
      out.push({ ...n, type: 'note', vid: `n:${n.id}` } as MixedNoteItem)
      continue
    }
    const { key, label } = getMonthKeyAndLabel(n)
    if (key !== lastKey) {
      out.push({ type: 'month-header', id: `hdr-${key}`, monthKey: key, label, vid: `h:${key}` })
      lastKey = key
    }
    out.push({ ...n, type: 'note', vid: `n:${n.id}` } as MixedNoteItem)
  }
  return out
})

const hasLeadingMonthHeader = computed(() => mixedItems.value[0]?.type === 'month-header')

/** noteId -> 混合列表 index（滚动定位用） */
const noteIdToMixedIndex = computed<Record<string, number>>(() => {
  const map: Record<string, number> = {}
  mixedItems.value.forEach((it, idx) => {
    if (it.type === 'note' && it.id)
      map[it.id] = idx
  })
  return map
})

/** 新增：id -> 原始笔记（向上滚兜底需要），用 normalizedNotes 更一致 */
const noteById = computed<Record<string, any>>(() => {
  const m: Record<string, any> = {}
  for (const n of normalizedNotes.value)
    m[n.id] = n

  return m
})

function scrollToMonth(year: number, month: number): boolean {
  if (!Array.isArray(mixedItems.value) || mixedItems.value.length === 0)
    return false

  const targetMonthKey = `${year}-${String(month).padStart(2, '0')}`

  // ① 优先：找到该月的 month-header
  let targetIndex = mixedItems.value.findIndex(
    item => item.type === 'month-header' && item.monthKey === targetMonthKey,
  )

  // ② 没有 header，再找第一条属于该月的 note
  if (targetIndex === -1) {
    targetIndex = mixedItems.value.findIndex((item) => {
      if (item.type !== 'note')
        return false

      const raw = item.date || item.created_at || item.updated_at
      if (!raw)
        return false

      const d = new Date(raw)
      if (Number.isNaN(d.getTime()))
        return false

      return d.getFullYear() === year && (d.getMonth() + 1) === month
    })
  }

  // ③ 还是没找到：说明当前缓存里根本没有这个月份
  if (targetIndex === -1)
    return false

  // ④ 用 DynamicScroller 的 scrollToItem
  if (scrollerRef.value && typeof (scrollerRef.value as any).scrollToItem === 'function') {
    ;(scrollerRef.value as any).scrollToItem(targetIndex, { align: 'start', behavior: 'smooth' })
    requestAnimationFrame(() => {
      recomputeStickyState()
    })
    return true
  }

  // ⑤ DOM 兜底
  const rootEl = (scrollerRef.value as any)?.$el as HTMLElement | undefined
  if (!rootEl)
    return false

  const itemEl = rootEl.querySelector(`[data-index="${targetIndex}"]`) as HTMLElement | null
  if (itemEl) {
    itemEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return true
  }

  return false
}

// ✅ 新增：统一处理 Resize 事件
// 既负责更新收起按钮位置，又负责在 PWA 恢复期修正滚动位置
function handleItemResize() {
  // 1. 原有逻辑：更新收起按钮
  updateCollapsePos()
}

const HEADER_HEIGHT = 26 // 与样式一致
const headerEls = ref<Record<string, HTMLElement>>({})
let headersIO: IntersectionObserver | null = null

/** 卸载时清理，避免“幽灵 header” */
function setHeaderEl(el: Element | null, monthKey: string) {
  if (!el) {
    if (headerEls.value[monthKey])
      delete headerEls.value[monthKey]

    return
  }
  headerEls.value[monthKey] = el as HTMLElement
  if (headersIO)
    headersIO.observe(el)
}

const currentMonthKey = ref<string>('')
const currentMonthLabel = computed(() => {
  if (!currentMonthKey.value)
    return ''

  const [y, m] = currentMonthKey.value.split('-')
  return t('notes.list.month_label', { year: Number(y), month: Number(m) })
})

/** 点击浮动月份条右侧的小倒三角 */
function handleStickyMonthClick() {
  if (!currentMonthKey.value)
    return

  // 把当前月份 key（如 "2025-11"）抛给父组件
  emit('monthHeaderClick', currentMonthKey.value)
}

const pushOffset = ref(0)

/** 新增：滚动方向（仅在向上滚时做月份兜底纠正） */
let lastScrollTop = 0
const scrollDir = ref<'up' | 'down' | 'none'>('none')

/** 基线：你的“向下滚正确”的逻辑（不改），仅在末尾对向上滚做兜底修正 */
function recomputeStickyState() {
  const root = scrollerRef.value?.$el as HTMLElement | undefined
  if (!root) {
    pushOffset.value = 0
    return
  }
  const rootTop = root.getBoundingClientRect().top
  const EPS = 1 // 抖动容差

  // 当前在 DOM 的 header，按几何位置排序
  const entries = Object.entries(headerEls.value)
    .map(([k, el]) => (el && el.isConnected) ? { key: k, top: el.getBoundingClientRect().top } : null)
    .filter(Boolean)
    .sort((a: any, b: any) => a.top - b.top) as Array<{ key: string; top: number }>

  if (entries.length === 0) {
    // header 被虚拟化回收：向上滚时用可见卡片兜底，避免整月显示成上个月
    if (scrollDir.value === 'up') {
      const topKey0 = getTopVisibleMonthKey(root)
      if (topKey0 && topKey0 !== currentMonthKey.value)
        currentMonthKey.value = topKey0
    }

    pushOffset.value = 0
    return
  }

  // 找“最后一个已越过顶部（top <= rootTop+EPS）的 header”
  let idxPrev = -1
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].top <= rootTop + EPS)
      idxPrev = i

    else
      break
  }

  if (idxPrev >= 0) {
    // 有 header 真越过顶部：当前月 = 该 header.key
    if (currentMonthKey.value !== entries[idxPrev].key)
      currentMonthKey.value = entries[idxPrev].key

    // 计算被“下一月”顶起的偏移
    const next = entries[idxPrev + 1]
    if (next) {
      const dist = next.top - rootTop
      const overlap = Math.max(0, HEADER_HEIGHT - dist)
      pushOffset.value = Math.min(HEADER_HEIGHT, overlap)
    }
    else {
      pushOffset.value = 0
    }
  }
  else {
    // 顶部之上没有任何 header：位于列表开头区域
    // 若未初始化，设为第一个 header；已有值则保持（迟滞，不提前切月）
    if (!currentMonthKey.value)
      currentMonthKey.value = entries[0].key

    const first = entries[0]
    const dist = first.top - rootTop
    const overlap = Math.max(0, HEADER_HEIGHT - dist)
    pushOffset.value = Math.min(HEADER_HEIGHT, overlap)
  }

  // ✅ 兜底：无论向上/向下滚，都用“视口内最靠上的非置顶笔记”纠正月份
  const topKey = getTopVisibleMonthKey(root)
  if (topKey && topKey !== currentMonthKey.value)
    currentMonthKey.value = topKey
}

// 让 .sticky-month 和 .month-header 宽度对齐（不遮住滚动条）
function syncStickyGutters() {
  const sc = scrollerRef.value?.$el as HTMLElement | undefined
  const wrap = wrapperRef.value as HTMLElement | null
  if (!sc || !wrap)
    return

  // 读取 .scroller 的左右 padding
  const cs = getComputedStyle(sc)
  const pl = Number.parseFloat(cs.paddingLeft) || 0
  const pr = Number.parseFloat(cs.paddingRight) || 0

  // 计算原生滚动条宽度（Windows 下通常 > 0，macOS overlay 通常为 0）
  const scrollbarW = sc.offsetWidth - sc.clientWidth

  // 和 .month-header 的 margin 左右 4px 对齐
  wrap.style.setProperty('--sticky-left', `${pl + 4}px`)
  wrap.style.setProperty('--sticky-right', `${pr + scrollbarW + 4}px`)
}

function getTopVisibleMonthKey(rootEl: HTMLElement): string {
  const scRect = rootEl.getBoundingClientRect()

  let topId: string | null = null
  let topY = Number.POSITIVE_INFINITY

  // 优化：先获取所有 value 数组，避免重复解构
  const elements = Object.entries(noteContainers.value)

  for (const [id, el] of elements) {
    if (!el || !el.isConnected)
      continue

    const dataId = el.getAttribute('data-note-id')
    if (dataId !== id)
      continue
    const r = el.getBoundingClientRect()

    // 如果元素完全在视口下方，直接跳过 (向下的大部分元素)
    if (r.top > scRect.bottom)
      continue
    // 如果元素完全在视口上方太远 (比如超过 2000px)，也可以跳过，但为了准确性先保留
    if (r.bottom < scRect.top - 500)
      continue

    const n = noteById.value[id]
    if (!n || _isPinned(n))
      continue

    const visible = !(r.bottom <= scRect.top || r.top >= scRect.bottom)
    if (!visible)
      continue

    if (r.top < topY) {
      topY = r.top
      topId = id
    }
  }

  if (topId) {
    const n = noteById.value[topId]
    const { key } = getMonthKeyAndLabel(n)
    return key || ''
  }
  return ''
}

// ---- 滚动状态（快速滚动先隐藏按钮，停止后恢复） ----
const isUserScrolling = ref(false)
let scrollHideTimer: number | null = null

let collapseRetryId: number | null = null
let collapseRetryCount = 0
function scheduleCollapseRetry() {
  if (collapseRetryId !== null)
    return

  collapseRetryCount = 0
  const step = () => {
    collapseRetryId = requestAnimationFrame(() => {
      if (isUserScrolling.value) {
        cancelAnimationFrame(collapseRetryId!)
        collapseRetryId = null
        return
      }
      updateCollapsePos()
      if (collapseVisible.value || ++collapseRetryCount >= 12) {
        cancelAnimationFrame(collapseRetryId!)
        collapseRetryId = null
        return
      }
      step()
    })
  }
  step()
}

const handleScroll = throttle(() => {
  const el = scrollerRef.value?.$el as HTMLElement | undefined
  if (!el) {
    updateCollapsePos()
    return
  }

  // ✅ 新增：判定滚动方向（不改变原逻辑）
  const curTop = el.scrollTop
  if (curTop > lastScrollTop)
    scrollDir.value = 'down'

  else if (curTop < lastScrollTop)
    scrollDir.value = 'up'

  lastScrollTop = curTop

  // 触底加载
  if (!props.isLoading && props.hasMore) {
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 300
    if (nearBottom)
      emit('loadMore')
  }

  // 滚动中隐藏按钮，停止 120ms 恢复
  isUserScrolling.value = true
  collapseVisible.value = false
  if (scrollHideTimer !== null) {
    window.clearTimeout(scrollHideTimer)
    scrollHideTimer = null
  }
  scrollHideTimer = window.setTimeout(() => {
    isUserScrolling.value = false
    updateCollapsePos()
    scheduleCollapseRetry()
  }, 120)

  // 同步悬浮月份条
  recomputeStickyState()

  updateCollapsePos()
  syncStickyGutters() // 同步左右留白，避免覆盖滚动条
  emit('scrolled', el.scrollTop)
}, 16)

function rebindScrollListener() {
  const scrollerElement = scrollerRef.value?.$el as HTMLElement | undefined
  if (!scrollerElement)
    return

  scrollerElement.removeEventListener('scroll', handleScroll)
  scrollerElement.addEventListener('scroll', handleScroll, { passive: true } as any)
}

watch(() => props.notes, () => {
  nextTick(() => {
    rebindScrollListener()
    updateCollapsePos()
    syncStickyGutters()
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        recomputeStickyState()
      })
    })
  })
}, { deep: false })

watch(scrollerRef, (newScroller, oldScroller) => {
  if (oldScroller?.$el)
    oldScroller.$el.removeEventListener('scroll', handleScroll)

  if (newScroller?.$el) {
    rebindScrollListener()
    nextTick(() => {
      updateCollapsePos()
      syncStickyGutters()
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          recomputeStickyState()
        })
      })
    })
  }
})

function handleWindowResize() {
  syncStickyGutters()
  updateCollapsePos()
}

onMounted(() => {
  window.addEventListener('resize', handleWindowResize, { passive: true })
  syncStickyGutters()
  const root = scrollerRef.value?.$el as HTMLElement | undefined
  if (root) {
    headersIO = new IntersectionObserver(() => {
      recomputeStickyState()
    }, { root })
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      recomputeStickyState()
    })
  })
})
onUnmounted(() => {
  window.removeEventListener('resize', handleWindowResize)
  handleScroll.cancel()
  if (collapseRetryId !== null) {
    cancelAnimationFrame(collapseRetryId)
    collapseRetryId = null
  }
  if (headersIO) {
    headersIO.disconnect()
    headersIO = null
  }
})

// 顶置编辑：增加一个会话 key，强制每次打开都 remount
const editSessionKey = ref(0)

// src/components/NoteList.vue

async function handleEditTop(note: any) {
  // 1. 设置状态
  emit('editingStateChange', true)
  editingNoteId.value = null
  expandedNote.value = null

  editingNoteTop.value = note
  // 默认填入服务器数据
  editTopContent.value = note?.content || ''

  // 2. 触发组件重建（关键！）
  // 这样 NoteEditor 每次打开都会重新执行 onMounted，从而触发内部的草稿检查
  editSessionKey.value++

  // 3. 滚动与聚焦
  const scroller = scrollerRef.value?.$el as HTMLElement | undefined
  if (scroller)
    scroller.scrollTo({ top: 0, behavior: 'smooth' })
  await nextTick()
  editTopEditorRef.value?.focus()
}

// 保存（顶置）
function saveEditTop(content: string /* , _weather: string | null */) {
  if (!editingNoteTop.value)
    return
  const id = editingNoteTop.value.id
  const trimmed = (content || '').trim()
  if (!trimmed)
    return

  // 仍然沿用父组件的更新回调：{ id, content }, (success)=>{}
  emit('updateNote', { id, content: trimmed }, async (success: boolean) => {
    // ❌ 保存失败：什么都不做，草稿继续保留
    if (!success)
      return

    // ✅ 保存成功：手动清除当前这条笔记的编辑草稿
    const key = editTopDraftKey.value
    if (key) {
      try {
        localStorage.removeItem(key)
        localStorage.removeItem(`${key}_ts`)
      }
      catch (err) {
        // 本地存储异常直接忽略，不影响后续逻辑
      }
    }

    // 关闭顶置编辑态 & 清空当前编辑内容
    editingNoteTop.value = null
    editTopContent.value = ''
    emit('editingStateChange', false)
    await restoreScrollIfNeeded()
  })
}

// 取消（顶置）
async function cancelEditTop() {
  editingNoteTop.value = null
  editTopContent.value = ''
  await restoreScrollIfNeeded()
  emit('editingStateChange', false)
}

function _ensureCardVisible(noteId: string) {
  const scroller = scrollerRef.value?.$el as HTMLElement | undefined
  const card = noteContainers.value[noteId] as HTMLElement | undefined
  if (!scroller || !card)
    return

  const scrollerRect = scroller.getBoundingClientRect()
  const cardRect = card.getBoundingClientRect()
  const padding = 12

  if (cardRect.top < scrollerRect.top + padding)
    card.scrollIntoView({ behavior: 'auto', block: 'start' })

  else if (cardRect.bottom > scrollerRect.bottom)
    card.scrollIntoView({ behavior: 'auto', block: 'nearest' })
}

async function toggleExpand(noteId: string) {
  if (editingNoteId.value === noteId)
    return

  const scroller = scrollerRef.value?.$el as HTMLElement | undefined
  const isCurrentlyExpanded = expandedNote.value === noteId
  const isSwitching = expandedNote.value !== null && !isCurrentlyExpanded
  if (!scroller)
    return

  if (isSwitching) {
    // 先收起旧的，再展开新的，避免高度突变
    expandedNote.value = null
    await nextTick()
    await new Promise(r => requestAnimationFrame(r))
  }

  if (!isCurrentlyExpanded) {
    // 记录展开前，卡片相对滚动容器顶部的偏移（用于展开后保持顶部不动）
    const card = noteContainers.value[noteId] as HTMLElement | undefined
    if (card) {
      const scRect = scroller.getBoundingClientRect()
      const cardRect = card.getBoundingClientRect()
      expandAnchor.value = {
        noteId,
        topOffset: cardRect.top - scRect.top, // 展开前的相对顶部偏移
        scrollTop: scroller.scrollTop,
      }
    }
    else {
      expandAnchor.value = { noteId, topOffset: 0, scrollTop: scroller.scrollTop }
    }

    // 展开
    expandedNote.value = noteId
    await nextTick()
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(r)))

    // ✅ 只向下展开：保持“展开前的顶部位置”不变
    const cardAfter = noteContainers.value[noteId] as HTMLElement | undefined
    if (cardAfter) {
      scroller.style.overflowAnchor = 'none'
      const scRectAfter = scroller.getBoundingClientRect()
      const cardRectAfter = cardAfter.getBoundingClientRect()

      // 目标是让 (卡片顶部相对滚动容器的偏移) == 展开前记录的 topOffset
      const anchor = expandAnchor.value
      const wantTopOffset
        = anchor.noteId === noteId ? anchor.topOffset : (cardRectAfter.top - scRectAfter.top)

      const currentTopOffset = cardRectAfter.top - scRectAfter.top
      const deltaAlign = currentTopOffset - wantTopOffset
      const target = scroller.scrollTop + deltaAlign

      await stableSetScrollTop(scroller, target, 6, 0.5)
      recomputeStickyState()
    }
  }
  else {
    // 收起：保持原有“回到展开前位置”的逻辑不变
    expandedNote.value = null
    scroller.style.overflowAnchor = 'none'

    await nextTick()
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(r)))

    const cardAfter = noteContainers.value[noteId] as HTMLElement | undefined
    if (cardAfter) {
      const scRectAfter = scroller.getBoundingClientRect()
      const cardRectAfter = cardAfter.getBoundingClientRect()
      const anchor = expandAnchor.value
      const wantTopOffset = (anchor.noteId === noteId) ? anchor.topOffset : 0
      const currentTopOffset = cardRectAfter.top - scRectAfter.top
      const delta = currentTopOffset - wantTopOffset

      let target = scroller.scrollTop + delta
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      target = Math.min(Math.max(0, target), maxScrollTop)

      await stableSetScrollTop(scroller, target, 6, 0.5)
      recomputeStickyState()
    }
    expandAnchor.value = { noteId: null, topOffset: 0, scrollTop: scroller.scrollTop }
  }

  updateCollapsePos()
}

async function stableSetScrollTop(el: HTMLElement, target: number, tries = 5, epsilon = 0.5) {
  target = Math.max(0, Math.min(target, el.scrollHeight - el.clientHeight))
  return new Promise<void>((resolve) => {
    let count = 0
    const tick = () => {
      const diff = Math.abs(el.scrollTop - target)
      if (diff > epsilon)
        el.scrollTop = target

      count += 1
      const reached = Math.abs(el.scrollTop - target) <= epsilon
      if (count >= tries || reached) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    el.scrollTop = target
    requestAnimationFrame(tick)
  })
}

watch(expandedNote, () => {
  nextTick(() => {
    updateCollapsePos()
  })
})

function updateCollapsePos() {
  if (isUserScrolling.value) {
    collapseVisible.value = false
    return
  }
  if (!expandedNote.value) {
    collapseVisible.value = false
    return
  }

  const scrollerEl = scrollerRef.value?.$el as HTMLElement | undefined
  const wrapperEl = wrapperRef.value as HTMLElement | null
  const cardEl = noteContainers.value[expandedNote.value]
  if (!scrollerEl || !wrapperEl || !cardEl || !cardEl.isConnected) {
    collapseVisible.value = false
    scheduleCollapseRetry()
    return
  }

  const dataId = (cardEl as HTMLElement).getAttribute('data-note-id')
  if (dataId !== expandedNote.value) {
    collapseVisible.value = false
    scheduleCollapseRetry()
    return
  }

  const scrollerRect = scrollerEl.getBoundingClientRect()
  const wrapperRect = wrapperEl.getBoundingClientRect()
  const cardRect = (cardEl as HTMLElement).getBoundingClientRect()

  // === 新增：用「视觉视口」修正真正可见的上下边界 ===
  const vv = window.visualViewport
  const viewportTop = vv ? vv.offsetTop : 0
  const viewportBottom = vv ? vv.offsetTop + vv.height : window.innerHeight

  // 滚动容器和视觉视口夹在一起，得到真正可见区
  const effectiveTop = Math.max(scrollerRect.top, viewportTop)
  const effectiveBottom = Math.min(scrollerRect.bottom, viewportBottom)

  // 卡片整体完全在可见区外，就不显示按钮
  const outOfView = cardRect.bottom <= effectiveTop || cardRect.top >= effectiveBottom
  if (outOfView) {
    collapseVisible.value = false
    scheduleCollapseRetry()
    return
  }

  const btnEl = collapseBtnRef.value
  const btnH = btnEl ? btnEl.offsetHeight : 36
  const margin = 10

  // 底部安全区：用于你的底部工具栏 / safe-area / inline 编辑器高度
  const safeInset = props.bottomInset ?? 0

  // 在卡片底部、滚动容器底部、视觉视口底部三者之间取「真正能看到的底边」
  const visibleBottom = Math.min(
    cardRect.bottom,
    effectiveBottom - margin - safeInset,
  )
  const visibleTop = Math.max(cardRect.top, effectiveTop + margin)

  // 如果计算后区间反向了，说明可用空间太小，直接不显示按钮
  if (visibleBottom <= visibleTop) {
    collapseVisible.value = false
    return
  }

  let topPx = visibleBottom - btnH
  // 你的微调：往上再提一点
  topPx -= 50
  if (topPx < visibleTop)
    topPx = visibleTop

  const leftPx = cardRect.left - wrapperRect.left + 0
  collapseStyle.value = { left: `${leftPx}px`, top: `${topPx - wrapperRect.top}px` }
  collapseVisible.value = true
}

async function focusAndEditNote(noteId: string) {
  const idx = noteIdToMixedIndex.value[noteId]
  if (idx !== undefined) {
    const original = normalizedNotes.value.find(n => n.id === noteId)
    if (original) {
      editingNoteId.value = noteId
      editingNoteContent.value = original.content
      await nextTick()
      scrollerRef.value?.scrollToItem(idx, { align: 'center', behavior: 'smooth' })
      requestAnimationFrame(() => {
        recomputeStickyState()
      })
    }
  }
}

// 在 NoteList.vue 底部找到 scrollToTop 函数，替换为：

function scrollToTop() {
  const el = scrollerRef.value?.$el as HTMLElement | undefined
  if (!el)
    return

  const startTop = el.scrollTop
  if (startTop <= 0)
    return

  // ⚡️ 优化策略：如果距离太远（例如 2万像素），先瞬间“瞬移”到近处（3000px）
  // 这样避免动画时间过长，也减少虚拟列表在高速滚动下的渲染压力
  const MAX_ANIMATION_DIST = 3000
  let effectiveStart = startTop

  if (startTop > MAX_ANIMATION_DIST) {
    effectiveStart = MAX_ANIMATION_DIST
    el.scrollTop = effectiveStart
  }

  const startTime = performance.now()
  const duration = 500 // 动画持续 500ms，你可以根据喜好调整（比如 800）

  // 缓动函数：Cubic Ease-out (一开始快，快到终点时慢慢停下)
  const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

  const frame = (now: number) => {
    const elapsed = now - startTime
    const progress = Math.min(elapsed / duration, 1) // 0 到 1

    const ease = easeOutCubic(progress)

    // 计算当前应该在哪
    const currentTop = effectiveStart * (1 - ease)

    el.scrollTop = currentTop

    if (progress < 1) {
      requestAnimationFrame(frame)
    }
    else {
      // 确保最后严丝合缝归零
      el.scrollTop = 0
      // 触发一次逻辑更新，确保月份条等状态正确
      handleScroll()
    }
  }

  requestAnimationFrame(frame)
}

defineExpose({ scrollToTop, focusAndEditNote, scrollToMonth })

async function restoreScrollIfNeeded() {
  const scroller = scrollerRef.value?.$el as HTMLElement | undefined
  if (!scroller || editReturnScrollTop.value == null)
    return
  // 等一帧让布局稳定再恢复
  await nextTick()
  await new Promise<void>(r => requestAnimationFrame(r))
  scroller.scrollTop = Math.max(0, Math.min(
    editReturnScrollTop.value,
    scroller.scrollHeight - scroller.clientHeight,
  ))
  editReturnScrollTop.value = null
}

function checkSameDay(currentItem, index) {
  // 1. 第一项肯定是新的，不弱化
  if (index <= 0)
    return false

  // 2. 获取上一项
  const prevItem = mixedItems.value[index - 1]

  // 3. 关键修复：排除“非笔记”元素（如月份标题）
  // 如果上一项没有 id，或者没有 content，通常说明它是个标题
  // 这种情况下，当前笔记应该是新的一组，所以返回 false (黑色)
  if (!prevItem || !prevItem.id || typeof prevItem.content === 'undefined')
    return false

  // 4. 严谨的时间比较：完全基于本地时间（和界面显示保持一致）
  const d1 = new Date(currentItem.created_at)
  const d2 = new Date(prevItem.created_at)

  // 5. 比较 年、月、日 是否完全相等
  return (
    d1.getFullYear() === d2.getFullYear()
    && d1.getMonth() === d2.getMonth()
    && d1.getDate() === d2.getDate()
  )
}
</script>

<template>
  <div ref="wrapperRef" class="notes-list-wrapper">
    <div
      v-if="currentMonthLabel && !isEditingTop"
      class="sticky-month"
      :style="{ transform: `translateY(${-pushOffset}px)` }"
    >
      <button
        type="button"
        class="sticky-month-main"
        @click.stop="handleStickyMonthClick"
      >
        <span class="sticky-month-label">
          {{ currentMonthLabel }}
        </span>
        <!-- 只保留你原来的这一个小倒三角 -->
        <span class="sticky-month-caret" />
      </button>
    </div>

    <div v-if="isLoading && notes.length === 0" class="py-4 text-center text-gray-500">
      {{ t('notes.loading') }}
    </div>
    <div v-else-if="notes.length === 0" class="py-4 text-center text-gray-500">
      {{ t('notes.no_notes') }}
    </div>

    <div v-show="isEditingTop" class="inline-editor" style="margin: 8px 8px 12px 8px;">
      <NoteEditor
        ref="editTopEditorRef"
        :key="`top-editor:${editingNoteTop?.id ?? 'none'}:${editSessionKey}`"
        v-model="editTopContent"
        :is-editing="true"
        :is-loading="false"
        :max-note-length="maxNoteLength"
        :placeholder="$t('notes.update_note')"
        :all-tags="allTags"
        enable-drafts
        :note-id="editingNoteTop?.id" :draft-key="editTopDraftKey"

        :clear-draft-on-save="true" :original-content="editingNoteTop?.content || ''"
        @save="saveEditTop"
        @cancel="cancelEditTop"
      />
    </div>

    <DynamicScroller
      v-show="!isEditingTop"
      ref="scrollerRef"
      :items="mixedItems"
      :min-item-size="126"
      :buffer="400"
      class="scroller"
      key-field="vid"
    >
      <template #before>
        <div :style="{ height: hasLeadingMonthHeader ? '0px' : `${HEADER_HEIGHT}px` }" />
      </template>
      <template #default="{ item, index, active }">
        <DynamicScrollerItem
          :item="item"
          :active="active"
          :data-index="index"
          :size-dependencies="item.type === 'note'
            ? [item.content, expandedNote === item.id, item.updated_at, item.vid]
            : [item.label, item.vid]"
          class="note-item-container"
          @resize="handleItemResize"
        >
          <div v-if="item.type === 'month-header'" class="month-header-outer">
            <div
              :ref="(el) => setHeaderEl(el, item.monthKey)"
              class="month-header"
              :data-month="item.monthKey"
            >
              {{ item.label }}
            </div>
          </div>

          <div
            v-else
            :ref="(el) => setNoteContainer(el, item.id)"
            class="note-selection-wrapper"
            :class="{ 'selection-mode': isSelectionModeActive }"
            @click.stop="isSelectionModeActive && emit('toggleSelect', item.id)"
          >
            <div v-if="isSelectionModeActive" class="selection-indicator">
              <div
                class="selection-circle"
                :class="{ selected: selectedNoteIds.includes(item.id) }"
              />
            </div>

            <div class="note-content-wrapper">
              <NoteItem
                :note="item"
                :is-expanded="expandedNote === item.id"
                :is-selection-mode-active="isSelectionModeActive"
                :search-query="searchQuery"
                :is-same-day="checkSameDay(item, index)"
                @toggle-expand="toggleExpand"
                @edit="handleEditTop(item)"
                @copy="(content) => emit('copyNote', content)"
                @pin="(note) => emit('pinNote', note)"
                @favorite="(note) => emit('favoriteNote', note)"
                @delete="(id) => emit('deleteNote', id)"
                @task-toggle="(payload) => emit('taskToggle', payload)"
                @date-updated="(payload) => emit('dateUpdated', payload)"
              />
            </div>
          </div>
        </DynamicScrollerItem>
      </template>

      <template #after>
        <div v-if="isLoading && notes.length > 0" class="py-4 text-center text-gray-500">
          {{ t('notes.loading') }}
        </div>
        <div class="list-bottom-spacer" :style="{ height: `${props.bottomInset}px` }" />
      </template>
    </DynamicScroller>

    <Transition name="fade">
      <button
        v-if="collapseVisible"
        ref="collapseBtnRef"
        type="button"
        class="collapse-button"
        :style="collapseStyle"
        @click.stop.prevent="toggleExpand(expandedNote!)"
      >
        {{ t('notes.collapse') }}
      </button>
    </Transition>
  </div>
</template>

<style scoped>
/* ... 样式部分保持不变 ... */
.notes-list-wrapper { position: absolute; top: 0; left: 0; right: 0; bottom: 0; }
.scroller { height: 100%; overflow-y: auto; overflow-anchor: none; scroll-behavior: auto; -webkit-overflow-scrolling: touch !important;}
/* 背景 */
.scroller { background-color: #e5e7eb; padding: 0.5rem; }
.dark .scroller { background-color: #0d1117; }
/* 卡片 */
.note-content-wrapper {
  background-color: #ffffff; border-radius: 12px; padding: 1rem;
   box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transition: box-shadow 0.2s ease-in-out;
}
.note-content-wrapper:hover { box-shadow: 0 2px 4px rgba(0,0,0,0.07), 0 4px 12px rgba(0,0,0,0.07); }
.dark .note-content-wrapper {
  background-color: #1f2937; border: 1px solid #374151;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
}
.dark .note-content-wrapper:hover { box-shadow: 0 2px 4px rgba(0,0,0,0.15), 0 4px 12px rgba(0,0,0,0.15); }
/* 间距与选择 */
.note-item-container { padding-bottom: 1.5rem; }
.note-item-container:last-child { padding-bottom: 0; }
.note-selection-wrapper { display: flex; gap: 0.75rem; transition: background-color 0.2s; }
.note-selection-wrapper.selection-mode {
  cursor: pointer; padding: 0.5rem;
  margin: -0.5rem -0.5rem calc(-0.5rem + 1.5rem) -0.5rem; border-radius: 8px;
}
.note-selection-wrapper.selection-mode:hover { background-color: rgba(0, 0, 0, 0.03); }
.dark .note-selection-wrapper.selection-mode:hover { background-color: rgba(255, 255, 255, 0.05); }
.note-content-wrapper { flex: 1; min-width: 0; }
/* 选择态圆点 */
.selection-indicator { padding-top: 0.75rem; }
.selection-circle { width: 20px; height: 20px; border-radius: 50%; border: 2px solid #ccc; transition: all 0.2s ease; }
.dark .selection-circle { border-color: #555; }
.selection-circle.selected { background-color: #00b386; border-color: #00b386; position: relative; }
.selection-circle.selected::after {
  content: ''; position: absolute; left: 6px; top: 2px; width: 5px; height: 10px;
  border: solid white; border-width: 0 2px 2px 0; transform: rotate(45deg);
}
/* 文案颜色 */
.text-gray-500 { color: #6b7280; }
.dark .text-gray-500 { color: #9ca3af; }
/* 收起按钮 */
.collapse-button {
  position: absolute; z-index: 10;
  background-color: #ffffff; color: #007bff; border: 1px solid #e0e0e0;
  border-radius: 15px; padding: 3px 8px; font-size: 14px; cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15); transition: opacity 0.2s, transform 0.2s;
  opacity: 0.9; font-weight: normal;
  font-family: 'KaiTi', 'BiauKai', '楷体', 'Apple LiSung', serif, sans-serif;
}
.collapse-button:hover { opacity: 1; transform: scale(1.05); }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* ===== 月份头部项（虚拟项） ===== */
.month-header-outer { padding: 5px 4px 0px 4px; } /* 原先的外边距搬到这里 */
/* 列表里“第一个可见 item”如果是月份卡片，则去掉上内边距，避免在悬浮条下方再留一条间隙 */
.scroller .note-item-container:first-child .month-header-outer {
  padding-top: 0;
}
.month-header {
  height: 26px;
  padding: 0 8px;
  margin: 0;
  border-radius: 8px;
  font-weight: 900;
  font-size: 15px;
  color: #374151;
  background: #eef2ff;
  border: 1px solid #e5e7eb;
  display: flex;
  align-items: center;
}
.dark .month-header {
  color: #e5e7eb;
  background: #1f2937;
  border: 1px solid #374151;
}

/* 悬浮月份条：外观与 .month-header 保持一致 */
.sticky-month {
  position: absolute;
  top: 0;
  left: var(--sticky-left, 4px);
  right: var(--sticky-right, 4px);
  z-index: 9;

  height: 26px;           /* 与 HEADER_HEIGHT 与 .month-header 一致 */
  padding: 0 8px;         /* 与 .month-header 一致 */

  /* 现在需要可点击 */
  pointer-events: auto;

  /* 外观与 .month-header 一致 */
  border-radius: 8px;
  background: #eef2ff;
  border: 1px solid #e5e7eb;

  font-weight: 900;
  font-size: 15px;
  color: #374151;

  display: flex;
  align-items: center;
  justify-content: flex-start; /* ✅ 全部靠左排布 */
  gap: 1px; /* 间距稍微小一点，更“紧挨” */
}

/* 暗色主题下保持一致 */
.dark .sticky-month {
  background: #1f2937;
  border: 1px solid #374151;
  color: #e5e7eb;
}
.list-bottom-spacer { width: 100%; flex: 0 0 auto; }

/* 左侧文字，自动占满剩余空间，避免被挤 */
.sticky-month-label {
  flex: 0 0 auto;           /* ✅ 不再拉伸，占自身宽度即可 */
  white-space: nowrap;
  overflow: visible;
  text-overflow: clip;
}

/* 实际的倒三角，用 border 画 */
.sticky-month-caret {
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 6px solid currentColor; /* 用文字颜色画出小三角 */
}

/* 点击区域（文字 + 倒三角） */
.sticky-month-main {
  display: inline-flex;
  align-items: center;
  gap: 4px;

  padding: 0;
  margin: 0;

  border: none;
  background: transparent;
  font: inherit;
  color: inherit;

  cursor: pointer;
}
</style>
