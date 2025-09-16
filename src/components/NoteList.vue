<script setup lang="ts">
import { defineExpose, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
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
const isUpdating = ref(false)

const noteContainers = ref<Record<string, HTMLElement>>({})

// ---- 新增：供 :ref 使用的辅助函数，避免模板里出现多语句 ----
function setNoteContainer(el: Element | null, id: string) {
  if (!el)
    return
  const $el = el as HTMLElement
  $el.setAttribute('data-note-id', id)
  noteContainers.value[id] = $el
}

// ---- 新增：滚动状态（快速滚动时先隐藏按钮，停止后再恢复） ----
const isUserScrolling = ref(false)
let scrollHideTimer: number | null = null

// ---- 新增：位置恢复轻量重试（最多 12 帧） ----
let collapseRetryId: number | null = null
let collapseRetryCount = 0
function scheduleCollapseRetry() {
  if (collapseRetryId !== null)
    return
  collapseRetryCount = 0
  const step = () => {
    collapseRetryId = requestAnimationFrame(() => {
      // 如果用户又开始滚动，停止重试
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

  // 触底加载
  if (!props.isLoading && props.hasMore) {
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 300
    if (nearBottom)
      emit('loadMore')
  }

  // —— 新增：滚动中先隐藏按钮，等停止 120ms 再恢复定位 —— //
  isUserScrolling.value = true
  collapseVisible.value = false
  if (scrollHideTimer !== null) {
    window.clearTimeout(scrollHideTimer)
    scrollHideTimer = null
  }
  scrollHideTimer = window.setTimeout(() => {
    isUserScrolling.value = false
    updateCollapsePos()
    // 停止后再安排一次轻量重试，确保复用中的节点就位后能恢复按钮
    scheduleCollapseRetry()
  }, 120)

  updateCollapsePos()
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
  })
}, { deep: false })

watch(scrollerRef, (newScroller, oldScroller) => {
  if (oldScroller?.$el)
    oldScroller.$el.removeEventListener('scroll', handleScroll)
  if (newScroller?.$el) {
    rebindScrollListener()
    nextTick(() => {
      updateCollapsePos()
    })
  }
})

onMounted(() => {
  window.addEventListener('resize', updateCollapsePos, { passive: true })
})
onUnmounted(() => {
  window.removeEventListener('resize', updateCollapsePos)
  handleScroll.cancel()
  if (collapseRetryId !== null) {
    cancelAnimationFrame(collapseRetryId)
    collapseRetryId = null
  }
})

function startEdit(note: any) {
  if (editingNoteId.value)
    cancelEdit()
  editingNoteId.value = note.id
  editingNoteContent.value = note.content
  expandedNote.value = null
  nextTick(() => {
    updateCollapsePos()
  })
}

function cancelEdit() {
  editingNoteId.value = null
  editingNoteContent.value = ''
}

async function handleUpdateNote() {
  if (!editingNoteId.value)
    return
  isUpdating.value = true
  emit(
    'updateNote',
    { id: editingNoteId.value, content: editingNoteContent.value },
    (success: boolean) => {
      // ✨ 将 isUpdating 的设置移到回调函数内部的最开始
      isUpdating.value = false
      if (success) {
        // ✨ 现在父组件已经处理完了返回逻辑，我们再安全地取消本地的编辑状态
        cancelEdit()
      }
    },
  )
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

// 请将此函数完整复制并替换您代码中旧的 toggleExpand 函数
async function toggleExpand(noteId: string) {
  if (editingNoteId.value === noteId)
    return

  const scroller = scrollerRef.value?.$el as HTMLElement | undefined
  const isCurrentlyExpanded = expandedNote.value === noteId
  const isSwitching = expandedNote.value !== null && !isCurrentlyExpanded

  if (!scroller)
    return

  // --- ✨ 核心修复逻辑：处理笔记切换的场景 ---
  // 如果用户正在从一个已展开的笔记切换到另一个，
  // 我们需要先将当前的笔记收起，等待DOM稳定，然后再展开新的。
  if (isSwitching) {
    // 1. 先平稳地收起当前已展开的笔记 (不进行滚动位置补偿)
    expandedNote.value = null
    // 2. 等待 Vue 完成 DOM 更新，让虚拟列表处理完收缩
    await nextTick()
    // 3. (推荐) 再等待一帧，确保浏览器完成布局渲染
    await new Promise(r => requestAnimationFrame(r))
    // 此时，旧笔记已收起，滚动环境已稳定，可以安全地继续执行展开操作
  }

  // --- 接下来的逻辑分为“展开”和“收起”两种情况 ---

  // Case 1: 展开一个新的笔记 (包括刚才处理完切换后，现在需要展开的笔记)
  if (!isCurrentlyExpanded) {
    const card = noteContainers.value[noteId] as HTMLElement | undefined

    // 记录锚点，用于未来收起时恢复位置
    if (card) {
      const scRect = scroller.getBoundingClientRect()
      const cardRect = card.getBoundingClientRect()
      expandAnchor.value = {
        noteId,
        topOffset: cardRect.top - scRect.top,
        scrollTop: scroller.scrollTop,
      }
    }
    else {
      expandAnchor.value = { noteId, topOffset: 0, scrollTop: scroller.scrollTop }
    }

    // 真正展开
    expandedNote.value = noteId

    // 等待虚拟列表完成布局
    await nextTick()
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(r)))

    // 将展开后的卡片滚动到视图顶部
    const cardAfter = noteContainers.value[noteId] as HTMLElement | undefined
    if (cardAfter) {
      scroller.style.overflowAnchor = 'none'
      const scRectAfter = scroller.getBoundingClientRect()
      const cardRectAfter = cardAfter.getBoundingClientRect()
      const topPadding = 0
      const deltaAlign = (cardRectAfter.top - scRectAfter.top) - topPadding
      const target = scroller.scrollTop + deltaAlign
      await stableSetScrollTop(scroller, target, 6, 0.5)
    }
  }
  // Case 2: 收起当前已展开的笔记 (isCurrentlyExpanded 为 true)
  else {
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
    }
    expandAnchor.value = { noteId: null, topOffset: 0, scrollTop: scroller.scrollTop }
  }

  // 统一在操作结束后更新收起按钮的位置
  updateCollapsePos()
}

// 在多帧内反复设定 scrollTop，直到稳定（解决虚拟列表/浏览器锚定回拉）
async function stableSetScrollTop(
  el: HTMLElement,
  target: number,
  tries = 5, // 最多纠正 5 帧
  epsilon = 0.5, // 允许的误差
) {
  target = Math.max(0, Math.min(target, el.scrollHeight - el.clientHeight))

  return new Promise<void>((resolve) => {
    let count = 0
    const tick = () => {
      const diff = Math.abs(el.scrollTop - target)
      if (diff > epsilon)
        el.scrollTop = target

      if (++count >= tries || Math.abs(el.scrollTop - target) <= epsilon) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    // 先设一次，再进入多帧校正
    el.scrollTop = target
    requestAnimationFrame(tick)
  })
}

function handleEditorFocus(containerEl: HTMLElement) {
  setTimeout(() => {
    if (containerEl && typeof containerEl.scrollIntoView === 'function')
      containerEl.scrollIntoView({ behavior: 'auto', block: 'nearest' })
  }, 300)
}

watch(expandedNote, () => {
  nextTick(() => {
    updateCollapsePos()
  })
})

function updateCollapsePos() {
  // 滚动过程中先隐藏，停止后由 handleScroll 延时恢复
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
    // 组件在复用/挂载的边缘态，安排轻量重试
    scheduleCollapseRetry()
    return
  }
  // —— 强校验该元素仍属于当前展开的笔记（防止虚拟列表复用导致错位） —— //
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
    // 已回到卡片附近时，下一两帧就会入视口，安排轻量重试
    scheduleCollapseRetry()
    return
  }
  const btnEl = collapseBtnRef.value
  const btnH = btnEl ? btnEl.offsetHeight : 36
  const margin = 10
  const visibleBottom = Math.min(cardRect.bottom, scrollerRect.bottom - margin)
  const visibleTop = Math.max(cardRect.top, scrollerRect.top + margin)
  let topPx = visibleBottom - btnH
  if (topPx < visibleTop)
    topPx = visibleTop
  const leftPx = cardRect.left - wrapperRect.left + 0
  collapseStyle.value = {
    left: `${leftPx}px`,
    top: `${topPx - wrapperRect.top}px`,
  }
  collapseVisible.value = true
}

// ✨ 新增：供父组件调用的方法，用于从外部触发笔记编辑
async function focusAndEditNote(noteId: string) {
  // 1. 在笔记数组中找到目标笔记的“索引位置”(index)
  const index = props.notes.findIndex(n => n.id === noteId)

  // 如果在当前列表里找到了这个笔记 (index !== -1)
  if (index !== -1) {
    const noteToEdit = props.notes[index]

    // 2. 先设置编辑状态，让 NoteEditor 准备好被渲染
    editingNoteId.value = noteId
    editingNoteContent.value = noteToEdit.content

    // 3. 等待 Vue 完成 DOM 更新
    await nextTick()

    // 4. ✨ 使用官方的、更可靠的 scrollToItem 方法，并让其滚动到中心位置
    scrollerRef.value?.scrollToItem(index, { align: 'center', behavior: 'smooth' })
  }
}

function scrollToTop() {
  scrollerRef.value?.scrollToItem(0)
}

defineExpose({
  scrollToTop,
  focusAndEditNote, // ✨ 新增暴露的方法
})
</script>

<template>
  <div ref="wrapperRef" class="notes-list-wrapper">
    <div v-if="isLoading && notes.length === 0" class="py-4 text-center text-gray-500">
      {{ t('notes.loading') }}
    </div>
    <div v-else-if="notes.length === 0" class="py-4 text-center text-gray-500">
      {{ t('notes.no_notes') }}
    </div>

    <DynamicScroller
      v-else
      ref="scrollerRef"
      :items="notes"
      :min-item-size="120"
      class="scroller"
      key-field="id"
    >
      <template #default="{ item, index, active }">
        <DynamicScrollerItem
          :item="item"
          :active="active"
          :data-index="index"
          :size-dependencies="[
            item.content,
            expandedNote === item.id,
            editingNoteId === item.id,
          ]"
          class="note-item-container"
          @resize="updateCollapsePos"
        >
          <div
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
              <NoteEditor
                v-if="editingNoteId === item.id"
                v-model="editingNoteContent"
                :is-editing="true"
                :is-loading="isUpdating"
                :max-note-length="maxNoteLength"
                :placeholder="$t('notes.update_note')"
                :all-tags="allTags"
                @save="handleUpdateNote"
                @cancel="cancelEdit"
                @focus="handleEditorFocus(noteContainers[item.id])"
              />
              <NoteItem
                v-else
                :note="item"
                :is-expanded="expandedNote === item.id"
                :is-selection-mode-active="isSelectionModeActive"
                :search-query="searchQuery"
                @toggle-expand="toggleExpand"
                @edit="startEdit"
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
        <div v-if="isLoading && notes.length > 0" class="text中心 py-4 text-gray-500">
          {{ t('notes.loading') }}
        </div>
      </template>
    </DynamicScroller>

    <Transition name="fade">
      <button
        v-if="collapseVisible"
        ref="collapseBtnRef"
        type="button"
        class="collapse-button"
        :style="collapseStyle"
        @click.stop.prevent="toggleExpand(expandedNote!, $event)"
      >
        收起
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.notes-list-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}
.scroller {
  height: 100%;
  overflow-y: auto;
  overflow-anchor: none; /* 关闭浏览器自身的锚定，避免与手动补偿冲突 */
  scroll-behavior: auto;
}
/* --- 全新的卡片化样式 --- */

/* 1. 给列表的背景一个非常浅的灰色，以衬托卡片 */
.scroller {
  height: 100%;
  overflow-y: auto;
  /* 新增：为滚动区域设置背景色 */
  background-color: #f9fafb;
  padding: 0.5rem; /* 给卡片和列表边缘留出一些空间 */
}
.dark .scroller {
  background-color: #111827; /* 深色模式下的深灰色背景 */
}

/* 2. 定义每个笔记卡片的基础样式 */
.note-content-wrapper {
  background-color: #ffffff; /* 卡片使用纯白色背景 */
  border-radius: 12px; /* 更圆润的卡片圆角 */
  padding: 1rem; /* 卡片内部的文字留白 */
  /* 关键：添加漂亮的阴影 */
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05), 0 2px 8px rgba(0, 0, 0, 0.05);
  transition: box-shadow 0.2s ease-in-out;
}
.note-content-wrapper:hover {
  box-shadow: 0 2px 4px rgba(0,0,0,0.07), 0 4px 12px rgba(0,0,0,0.07);
}

/* 3. 为深色模式定义卡片样式 */
.dark .note-content-wrapper {
  background-color: #1f2937; /* 深色卡片背景 */
  border: 1px solid #374151; /* 在深色模式下加一个细边框，轮廓更清晰 */
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.1);
}
.dark .note-content-wrapper:hover {
   box-shadow: 0 2px 4px rgba(0,0,0,0.15), 0 4px 12px rgba(0,0,0,0.15);
}

/* 4. 调整外部容器的间距 */
.note-item-container {
  padding-bottom: 1rem; /* 设置卡片之间的垂直间距 */
}
.note-item-container:last-child {
  padding-bottom: 0.5rem; /* 最后一个卡片的间距可以小一点 */
}
.note-item-container {
  padding-bottom: 1.5rem;
}
.note-item-container:last-child {
  padding-bottom: 0;
}
.note-selection-wrapper {
  display: flex;
  gap: 0.75rem;
  transition: background-color 0.2s;
}
.note-selection-wrapper.selection-mode {
  cursor: pointer;
  padding: 0.5rem;
  margin: -0.5rem -0.5rem calc(-0.5rem + 1.5rem) -0.5rem;
  border-radius: 8px;
}
.note-selection-wrapper.selection-mode:hover {
  background-color: rgba(0, 0, 0, 0.03);
}
.dark .note-selection-wrapper.selection-mode:hover {
  background-color: rgba(255, 255, 255, 0.05);
}
.note-content-wrapper {
  flex: 1;
  min-width: 0;
}
.selection-indicator {
  padding-top: 0.75rem;
}
.selection-circle {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid #ccc;
  transition: all 0.2s ease;
}
.dark .selection-circle {
  border-color: #555;
}
.selection-circle.selected {
  background-color: #00b386;
  border-color: #00b386;
  position: relative;
}
.selection-circle.selected::after {
  content: '';
  position: absolute;
  left: 6px;
  top: 2px;
  width: 5px;
  height: 10px;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.text-gray-500 {
  color: #6b7280;
}
.dark .text-gray-500 {
  color: #9ca3af;
}
.collapse-button {
  position: absolute;
  z-index: 10;
  background-color: #ffffff; /* 改为白色 */
  color: #007bff;            /* 改为一个漂亮的蓝色，您也可以直接用 'blue' */
  border: 1px solid #e0e0e0;  /* (推荐) 增加一个浅灰色边框，使其更清晰 */
  border-radius: 15px;
  padding: 3px 8px;
  font-size: 14px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15); /* 阴影可以调浅一些 */
  transition: opacity 0.2s, transform 0.2s;
  opacity: 0.9; /* 可以让它稍微不那么透明 */
  font-weight: normal;
  font-family: 'KaiTi', 'BiauKai', '楷体', 'Apple LiSung', serif, sans-serif;
}
.collapse-button:hover {
  opacity: 1;
  transform: scale(1.05);
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
