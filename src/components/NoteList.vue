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
])

// 记录“展开瞬间”的锚点，用于收起时恢复
const expandAnchor = ref<{ noteId: string | null; topOffset: number; scrollTop: number }>({
  noteId: null,
  topOffset: 0,
  scrollTop: 0,
})

const { t } = useI18n()

const scrollerRef = ref<any>(null)
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
  if (!el)
    return

  const $el = el as HTMLElement
  $el.setAttribute('data-note-id', id)
  noteContainers.value[id] = $el
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

/** 新增：用“视口内最靠上的非置顶笔记”的月份纠正 currentMonthKey（仅向上滚调用） */
// —— 返回“视口内最靠上的非置顶笔记”的月份 key（找不到返回空串）
function getTopVisibleMonthKey(rootEl: HTMLElement): string {
  const scRect = rootEl.getBoundingClientRect()

  let topId: string | null = null
  let topY = Number.POSITIVE_INFINITY

  for (const [id, el] of Object.entries(noteContainers.value)) {
    if (!el || !el.isConnected)
      continue

    // 防止虚拟列表复用导致错位
    const dataId = el.getAttribute('data-note-id')
    if (dataId !== id)
      continue

    const n = noteById.value[id]
    if (!n || _isPinned(n))
      continue

    const r = el.getBoundingClientRect()
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
  // 🔁 冷启动“双 RAF”以确保虚拟列表完成首屏布局后再计算悬浮月份条
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

async function handleEditTop(note: any) {
  emit('editingStateChange', true)
  editingNoteId.value = null
  expandedNote.value = null

  editingNoteTop.value = note
  editTopContent.value = note?.content || ''

  // 🔑 每次进入编辑都自增，触发 :key 变化 → 组件 remount → 重置 isDirty 基线
  editSessionKey.value++

  // （可选）你原来的滚到顶部、聚焦等逻辑……
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
    if (!success)
      return
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
  const outOfView = cardRect.bottom <= scrollerRect.top || cardRect.top >= scrollerRect.bottom
  if (outOfView) {
    collapseVisible.value = false
    scheduleCollapseRetry()
    return
  }
  const btnEl = collapseBtnRef.value
  const btnH = btnEl ? btnEl.offsetHeight : 36
  const margin = 10
  const visibleBottom = Math.min(cardRect.bottom, scrollerRect.bottom - margin)
  const visibleTop = Math.max(cardRect.top, scrollerRect.top + margin)
  let topPx = visibleBottom - btnH
  // 下面这个topPx -= 20是收起按钮的位置高度
  topPx -= 20
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

function scrollToTop() {
  scrollerRef.value?.scrollToItem(0)
}

defineExpose({ scrollToTop, focusAndEditNote })

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
</script>

<template>
  <div ref="wrapperRef" class="notes-list-wrapper">
    <!-- 悬浮月份条：不影响“收起”按钮（z-index 更低，且 pointer-events:none） -->
    <div
      v-if="currentMonthLabel"
      class="sticky-month"
      :style="{ transform: `translateY(${-pushOffset}px)` }"
    >
      {{ currentMonthLabel }}
    </div>

    <div v-if="isLoading && notes.length === 0" class="py-4 text-center text-gray-500">
      {{ t('notes.loading') }}
    </div>
    <div v-else-if="notes.length === 0" class="py-4 text-center text-gray-500">
      {{ t('notes.no_notes') }}
    </div>

    <!-- 顶置编辑框（出现在列表顶部） -->
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
        :draft-key="editTopDraftKey"

        clear-draft-on-save
        :original-content="editingNoteTop?.content || ''"

        @save="saveEditTop"
        @cancel="cancelEditTop"
      />
    </div>

    <DynamicScroller
      v-show="!isEditingTop"
      ref="scrollerRef"
      :items="mixedItems"
      :min-item-size="120"
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
          @resize="updateCollapsePos"
        >
          <!-- 月份头部条幅（作为虚拟项参与虚拟化） -->
          <div v-if="item.type === 'month-header'" class="month-header-outer">
            <div
              :ref="(el) => setHeaderEl(el, item.monthKey)"
              class="month-header"
              :data-month="item.monthKey"
            >
              {{ item.label }}
            </div>
          </div>

          <!-- 笔记项（已移除内联编辑器） -->
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
              <!-- 仅渲染卡片；编辑改为触发顶置编辑框 -->
              <NoteItem
                :note="item"
                :is-expanded="expandedNote === item.id"
                :is-selection-mode-active="isSelectionModeActive"
                :search-query="searchQuery"
                @toggle-expand="toggleExpand"
                @edit="handleEditTop(item)"
                @copy="(content) => emit('copyNote', content)"
                @pin="(note) => emit('pinNote', note)"
                @delete="(id) => emit('deleteNote', id)"
                @task-toggle="(payload) => emit('taskToggle', payload)"
                @date-updated="() => emit('dateUpdated')"
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
.notes-list-wrapper { position: absolute; top: 0; left: 0; right: 0; bottom: 0; }
.scroller { height: 100%; overflow-y: auto; overflow-anchor: none; scroll-behavior: auto; }
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
  pointer-events: none;

  /* ✅ 关键：与 .month-header 同样的圆角与描边/背景 */
  border-radius: 8px;
  background: #eef2ff;
  border: 1px solid #e5e7eb;

  /* 与 .month-header 一致的文字样式 */
  font-weight: 900;
  font-size: 15px;
  color: #374151;

  display: flex;
  align-items: center;
}

/* 暗色主题下保持一致 */
.dark .sticky-month {
  background: #1f2937;
  border: 1px solid #374151;
  color: #e5e7eb;
}
.list-bottom-spacer { width: 100%; flex: 0 0 auto; }
</style>
