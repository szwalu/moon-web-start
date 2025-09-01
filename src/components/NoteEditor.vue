<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

/**
 * Flomo 风格底部抽屉式 NoteEditor
 * 关键点：
 * - 抽屉 .ne-sheet 使用 fixed 定位，bottom 动态上移 keyboardHeight + safe-area
 * - 表单区域 flex，当中 textarea 为唯一滚动容器（flex:1; min-height:0; overflow:auto）
 * - 不对 textarea 进行 scrollTop 人为干预，避免「只能滚到第4行」问题
 * - 自动保存采用防抖，父组件监听 @save(content) 执行持久化（保留你的持久化实现）
 */

const props = defineProps<{
  modelValue: boolean // 控制抽屉显示
  content: string // v-model:content
  isLoading?: boolean // 正在保存
  maxNoteLength?: number // 最大长度
  autoSaveDelayMs?: number // 自动保存延迟（防抖）
  placeholder?: string // 占位文本
  editingNote?: boolean // 是否编辑已有笔记（影响按钮文案）
  title?: string // 抽屉标题
}>()

const emit = defineEmits<{
  (e: 'update:content', v: string): void
  (e: 'save', v: string): void
  (e: 'close'): void
}>()

// 默认值
const isLoading = computed(() => props.isLoading ?? false)
const maxNoteLength = computed(() => props.maxNoteLength ?? 3000)
const autoDelay = computed(() => props.autoSaveDelayMs ?? 1200)
const placeholder = computed(() => props.placeholder ?? '写点什么...')
const editingNote = computed(() => props.editingNote ?? false)
const titleText = computed(() => props.title ?? (editingNote.value ? '编辑笔记' : '新建笔记'))

// 本地内容副本（避免父组件延迟更新导致的输入抖动）
const localContent = ref(props.content ?? '')
watch(() => props.content, (v) => {
  if (v !== localContent.value)
    localContent.value = v ?? ''
})

// v-model 同步
watch(localContent, v => emit('update:content', v))

// 统计 & 保存时间
const charCount = computed(() => (localContent.value?.length ?? 0))
const lastSavedTime = ref('')

// 视口/键盘处理
const sheetRef = ref<HTMLElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const bottomInset = ref(0) // bottom 偏移（键盘高度 + 安全区）

function safeBottom(): number {
  // 使用 CSS env(safe-area-inset-bottom) 的计算结果，JS 兜底 0
  const el = document.createElement('div')
  el.style.paddingBottom = 'env(safe-area-inset-bottom)'
  document.body.appendChild(el)
  const px = getComputedStyle(el).paddingBottom
  document.body.removeChild(el)
  const n = Number.parseFloat(px || '0')
  if (Number.isFinite(n))
    return n
  return 0
}

function updateBottomByKeyboard(): void {
  const layoutH = window.innerHeight
  const vvH = window.visualViewport ? window.visualViewport.height : layoutH
  const keyboard = Math.max(0, layoutH - vvH)
  bottomInset.value = keyboard + safeBottom()
}

function onViewportResize(): void {
  updateBottomByKeyboard()
  // 不改变 textarea 的 scrollTop，保持用户滚动边界完整
}

// 打开抽屉时聚焦 textarea（下一帧，避免布局抖动）
watch(() => props.modelValue, async (v) => {
  if (!v)
    return
  await nextTick()
  updateBottomByKeyboard()
  const ta = textareaRef.value
  if (ta)
    ta.focus()
})

// 自动保存（防抖）
let timer: number | null = null
function onInput(): void {
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
  timer = window.setTimeout(() => {
    autoSave()
  }, autoDelay.value)
}

function autoSave(): void {
  if (!trimmed(localContent.value))
    return
  emit('save', localContent.value)
  lastSavedTime.value = formatNow()
}

function handleSubmit(): void {
  if (!trimmed(localContent.value))
    return
  // 先清掉自动保存计时，避免重复
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
  emit('save', localContent.value)
  lastSavedTime.value = formatNow()
}

function handleClose(): void {
  emit('close')
}

function trimmed(s: string): string {
  return (s || '').trim()
}

function formatNow(): string {
  const d = new Date()
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  const ss = d.getSeconds().toString().padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

// i18n：若全局存在 $t 就使用，否则给默认中文
function t(key: string): string {
  const inst = getCurrentInstance()
  const proxy = (inst && (inst.proxy as any)) || null
  const maybeT = proxy && typeof proxy.$t === 'function' ? proxy.$t : null
  if (maybeT)
    return String(maybeT(key))

  const dict: Record<string, string> = {
    'notes.saving': '保存中…',
    'notes.save_note': '保存',
    'notes.update_note': '更新',
    'notes.auto_saved_at': '自动保存',
  }
  return dict[key] ?? key
}

onMounted(() => {
  updateBottomByKeyboard()
  if (window.visualViewport)
    window.visualViewport.addEventListener('resize', onViewportResize)
  else
    window.addEventListener('resize', onViewportResize)
})

onBeforeUnmount(() => {
  if (window.visualViewport)
    window.visualViewport.removeEventListener('resize', onViewportResize)
  else
    window.removeEventListener('resize', onViewportResize)

  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
})

// 供样式绑定
const sheetStyle = computed(() => ({
  bottom: `${bottomInset.value}px`,
}))
</script>

<template>
  <!-- 遮罩层 -->
  <transition name="fade">
    <div
      v-if="modelValue"
      class="ne-overlay"
      @click.self="handleClose"
    />
  </transition>

  <!-- 底部抽屉 -->
  <transition name="sheet">
    <div
      v-if="modelValue"
      ref="sheetRef"
      class="ne-sheet"
      :style="sheetStyle"
      role="dialog"
      aria-modal="true"
    >
      <!-- 顶部拖拽条/标题区 -->
      <div class="ne-header">
        <div class="ne-grabber" />
        <div class="ne-title">{{ titleText }}</div>
        <button class="ne-close" type="button" @click="handleClose">✕</button>
      </div>

      <!-- 工具栏（可插槽自定义） -->
      <div class="ne-toolbar">
        <slot name="toolbar">
          <div class="ne-toolbar-placeholder">
            <span>#</span>
            <span>🖼️</span>
            <span>B</span>
            <span>⋯</span>
          </div>
        </slot>
      </div>

      <!-- 编辑区 -->
      <form class="ne-form" autocomplete="off" @submit.prevent="handleSubmit">
        <textarea
          ref="textareaRef"
          v-model="localContent"
          class="ne-textarea"
          :placeholder="placeholder"
          :maxlength="maxNoteLength"
          :disabled="isLoading"
          @input="onInput"
          @keydown.meta.enter.stop.prevent="handleSubmit"
          @keydown.ctrl.enter.stop.prevent="handleSubmit"
        />

        <!-- 底部信息 + 按钮（不覆盖 textarea，自身占位） -->
        <div class="ne-footer">
          <div class="ne-status">
            <span class="ne-counter">
              {{ charCount }} / {{ maxNoteLength }}
            </span>
            <span v-if="lastSavedTime" class="ne-saved">
              💾 {{ t('notes.auto_saved_at') }}: {{ lastSavedTime }}
            </span>
          </div>
          <div class="ne-actions">
            <button
              class="ne-btn"
              type="submit"
              :disabled="isLoading || !trimmed(localContent)"
            >
              {{ isLoading ? t('notes.saving') : (editingNote ? t('notes.update_note') : t('notes.save_note')) }}
            </button>
          </div>
        </div>
      </form>
    </div>
  </transition>
</template>

<style scoped>
/* ========== 动画 ========== */
.fade-enter-active, .fade-leave-active { transition: opacity .18s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.sheet-enter-active, .sheet-leave-active {
  transition: transform .24s ease, opacity .24s ease;
}
.sheet-enter-from, .sheet-leave-to {
  transform: translateY(16px);
  opacity: 0.98;
}

/* ========== 遮罩 ========== */
.ne-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.32);
  z-index: 998;
}

/* ========== 抽屉主体 ========== */
.ne-sheet {
  position: fixed;
  left: 0;
  right: 0;
  /* bottom 由 JS 按键盘高度动态调整 */
  bottom: 0;

  z-index: 999;
  margin: 0 auto;
  max-width: 720px;

  display: flex;
  flex-direction: column;

  border-top-left-radius: 14px;
  border-top-right-radius: 14px;
  background: #fff;
  box-shadow: 0 -8px 20px rgba(0,0,0,.12);

  min-height: min(88vh, 640px);
  max-height: 88vh;
  height: auto;

  overflow: hidden;
}

/* header */
.ne-header {
  position: relative;
  padding: 10px 44px 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ne-grabber {
  position: absolute;
  top: 6px;
  left: 50%;
  transform: translateX(-50%);
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: rgba(0,0,0,.15);
}
.ne-title {
  font-size: 14px;
  color: #666;
}
.ne-close {
  position: absolute;
  right: 8px;
  top: 6px;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  font-size: 18px;
  line-height: 32px;
  cursor: pointer;
}

/* 工具栏（默认占位，可插槽覆盖） */
.ne-toolbar {
  padding: 6px 12px 0;
  border-top: 1px solid rgba(0,0,0,.06);
}
.ne-toolbar-placeholder {
  display: flex;
  gap: 12px;
  color: #666;
  user-select: none;
}

/* 表单主体：textarea 自身滚动 */
.ne-form {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 文本域：唯一滚动容器 */
.ne-textarea {
  flex: 1;
  min-height: 0;
  width: 100%;
  border: none;
  resize: none;
  outline: none;
  font-size: 17px;
  line-height: 1.5;
  padding: 12px 14px 12px;
  overflow: auto;
  background: #fff;
  color: #111;

  -webkit-overflow-scrolling: touch;
}

/* 底部栏：不覆盖 textarea，自身占位 */
.ne-footer {
  flex: none;
  border-top: 1px solid rgba(0,0,0,.06);
  padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
  background: #fff;
}
.ne-status {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: #666;
  padding: 4px 2px;
}
.ne-actions {
  display: flex;
  gap: 8px;
  padding-top: 4px;
}
.ne-btn {
  appearance: none;
  border: 0;
  background: #22c55e;
  color: #fff;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
.ne-btn:disabled {
  opacity: .6;
  cursor: not-allowed;
}

/* 小屏优化 */
@media (max-width: 420px) {
  .ne-sheet {
    min-height: 70vh;
    max-height: 88vh;
  }
  .ne-textarea {
    font-size: 16px;
  }
}
</style>
