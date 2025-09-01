<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  editingNote: { type: Object, default: null },
  isLoading: { type: Boolean, default: false },
  allTags: { type: Array as () => string[], default: () => [] },
  maxNoteLength: { type: Number, default: 3000 },
  lastSavedTime: { type: String, default: '' },
})

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'submit'): void
  (e: 'triggerAutoSave'): void
  (e: 'close'): void
}>()

const wrapperRef = ref<HTMLElement | null>(null)
const editorRef = ref<HTMLElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const actionsRef = ref<HTMLElement | null>(null)
const showTagPanel = ref(false)
const filteredTags = ref<string[]>([])
const caretPos = ref(0)
const isTagging = ref(false)
const tagQuery = ref('')

let actionsRO: ResizeObserver | null = null
let editorRO: ResizeObserver | null = null

// 用于 spacer 高度
const actionsPad = ref(80)

const valueLen = computed(() => props.modelValue?.length ?? 0)
const remain = computed(() => Math.max(0, props.maxNoteLength - valueLen.value))

function resizeTextarea() {
  const el = textareaRef.value
  if (!el)
    return
  el.style.height = 'auto'
  el.style.maxHeight = 'none'
  el.style.overflow = 'hidden'
  el.style.height = `${el.scrollHeight}px`
}

function updateLayoutByActionsHeight() {
  const actionsH = actionsRef.value?.offsetHeight ?? 64
  const pad = actionsH + 16
  actionsPad.value = pad
  document.documentElement.style.setProperty('--actions-h', `${pad}px`)
  const editor = editorRef.value
  if (editor)
    editor.style.maxHeight = `calc(min(560px, var(--vvh, 100dvh)) - ${pad} - 32px)`
}

function keepCaretVisible() {
  const editor = editorRef.value
  const el = textareaRef.value
  if (!editor || !el)
    return
  const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length
  if (atEnd) {
    editor.scrollTop = editor.scrollHeight
  }
  else {
    const lh = Number.parseFloat(getComputedStyle(el).lineHeight) || 20
    editor.scrollTop = Math.min(editor.scrollTop + lh, editor.scrollHeight)
  }
}

function updateModel(v: string) {
  if (v.length > props.maxNoteLength)
    v = v.slice(0, props.maxNoteLength)
  emit('update:modelValue', v)
  emit('triggerAutoSave')
  nextTick(() => {
    resizeTextarea()
    updateLayoutByActionsHeight()
    keepCaretVisible()
  })
}

function onInput(e: Event) {
  const target = e.target as HTMLTextAreaElement
  const val = target.value
  caretPos.value = target.selectionStart || 0
  updateModel(val)
  detectTagging(val)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault()
    emit('submit')
    return
  }
  if (e.key === 'Escape') {
    emit('close')
    return
  }
  requestAnimationFrame(keepCaretVisible)
}

function detectTagging(val: string) {
  const pos = caretPos.value
  const left = val.slice(0, pos)
  const m = left.match(/(^|\s)#([\p{Letter}\p{Number}_\-]{0,30})$/u)
  if (m) {
    isTagging.value = true
    tagQuery.value = m[2] || ''
    filterTags()
  }
  else {
    isTagging.value = false
    showTagPanel.value = false
    tagQuery.value = ''
  }
}

function filterTags() {
  const q = tagQuery.value.toLowerCase()
  const full = (props.allTags || []).map(t => t.startsWith('#') ? t.slice(1) : t)
  const list = q ? full.filter(t => t.toLowerCase().includes(q)) : full
  filteredTags.value = list.slice(0, 8)
  showTagPanel.value = filteredTags.value.length > 0
}

function insertTag(raw: string) {
  const tag = raw.startsWith('#') ? raw : `#${raw}`
  const el = textareaRef.value
  if (!el)
    return
  const val = props.modelValue
  const pos = el.selectionStart || 0
  const left = val.slice(0, pos)
  const right = val.slice(pos)
  const replacedLeft = left.replace(/(^|\s)#([\p{Letter}\p{Number}_\-]{0,30})$/u, `$1${tag} `)
  const nextVal = replacedLeft + right
  updateModel(nextVal)
  nextTick(() => {
    const newPos = replacedLeft.length
    el.focus()
    el.setSelectionRange(newPos, newPos)
  })
  isTagging.value = false
  showTagPanel.value = false
  tagQuery.value = ''
}

function onPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text/plain')
  if (!text)
    return
  e.preventDefault()
  const el = textareaRef.value
  if (!el)
    return
  const start = el.selectionStart || 0
  const end = el.selectionEnd || 0
  const before = props.modelValue.slice(0, start)
  const after = props.modelValue.slice(end)
  updateModel(before + text + after)
  nextTick(() => {
    const pos = before.length + text.length
    el.focus()
    el.setSelectionRange(pos, pos)
  })
}

watch(() => props.modelValue, () => nextTick(() => {
  resizeTextarea()
  updateLayoutByActionsHeight()
  keepCaretVisible()
}))

onMounted(() => {
  nextTick(() => {
    resizeTextarea()
    updateLayoutByActionsHeight()
    textareaRef.value?.focus()
  })

  const applyViewportFix = () => {
    const vv = (window as any).visualViewport
    const h = vv?.height || window.innerHeight
    const kb = Math.max(0, window.innerHeight - h)
    document.documentElement.style.setProperty('--vvh', `${h}px`)
    document.documentElement.style.setProperty('--kb', `${kb}px`)
    updateLayoutByActionsHeight()
  }
  applyViewportFix()
  const vv = (window as any).visualViewport
  if (vv) {
    vv.addEventListener('resize', applyViewportFix)
    vv.addEventListener('scroll', applyViewportFix)
  }
  else {
    window.addEventListener('resize', applyViewportFix)
  }

  if ('ResizeObserver' in window) {
    actionsRO = new ResizeObserver(() => updateLayoutByActionsHeight())
    if (actionsRef.value)
      actionsRO.observe(actionsRef.value)

    editorRO = new ResizeObserver(() => updateLayoutByActionsHeight())
    if (editorRef.value)
      editorRO.observe(editorRef.value)
  }
})

onUnmounted(() => {
  if (actionsRO)
    actionsRO.disconnect()
  if (editorRO)
    editorRO.disconnect()
})
</script>

<template>
  <div ref="wrapperRef" class="ne-modal" role="dialog" aria-modal="true" @click.self="emit('close')">
    <div class="ne-card" @click.stop>
      <div class="ne-topbar">
        <div class="ne-left">
          <span v-if="editingNote" class="ne-chip">编辑中</span>
        </div>
        <div class="ne-right">
          <span v-if="lastSavedTime" class="ne-meta">上次保存：{{ lastSavedTime }}</span>
          <span class="ne-count" :class="{ danger: remain < 50 }">{{ remain }}</span>
          <button class="ne-close" type="button" aria-label="关闭" @click="emit('close')">×</button>
        </div>
      </div>

      <div ref="editorRef" class="ne-editor">
        <textarea
          ref="textareaRef"
          class="ne-textarea"
          :value="modelValue"
          :placeholder="editingNote ? '继续编辑…（回车发送，Shift+回车换行）' : '快速记录想法…（回车发送，Shift+回车换行）'"
          :disabled="isLoading"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          @keydown="onKeydown"
          @input="onInput"
          @paste="onPaste"
        />

        <div v-if="showTagPanel && isTagging" class="ne-tag-panel">
          <button
            v-for="tag in filteredTags"
            :key="tag"
            class="ne-tag-item"
            type="button"
            @click="insertTag(tag)"
          >
            #{{ tag }}
          </button>
        </div>

        <!-- spacer: 给滚动内容在底部留白，避免被 sticky 操作区遮挡 -->
        <div class="ne-spacer" :style="{ height: `${actionsPad}px` }" />
      </div>

      <div ref="actionsRef" class="ne-actions">
        <button class="ne-cancel" type="button" @click="emit('close')">取消</button>
        <button class="ne-submit" :disabled="isLoading || !modelValue" @click="$emit('submit')">
          {{ isLoading ? '保存中…' : (editingNote ? '更新笔记' : '保存笔记') }}
        </button>
      </div>
      <div class="ne-hint">按 Enter 发送 · Shift+Enter 换行 · 点空白关闭</div>
    </div>
  </div>
</template>

<style scoped>
.ne-modal {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  z-index: 1002;
  padding: 16px;
  padding-bottom: calc(16px + var(--kb, 0px));
}

.ne-card {
  width: 100%;
  max-width: 560px;
  background: var(--ne-bg, #fff);
  color: var(--ne-fg, #222);
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,.12);
  padding: 12px 12px calc(12px + env(safe-area-inset-bottom));
  max-height: calc(min(560px, var(--vvh, 100dvh)) - 32px);
  overflow: auto;
}
:global(.dark) .ne-card { --ne-bg: #1f1f1f; --ne-fg: #e6e6e6; }

.ne-topbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; font-size: inherit; }
.ne-left { display: flex; gap: 6px; align-items: center; }
.ne-right { display: flex; gap: 8px; align-items: center; }
.ne-chip { padding: 2px 8px; font-size: 12px; border-radius: 999px; background: rgba(0,0,0,.06); }
:global(.dark) .ne-chip { background: rgba(255,255,255,.12); }

.ne-meta { opacity: .7; font-size: 12px; }
.ne-count { font-variant-numeric: tabular-nums; font-size: 12px; opacity: .9; }
.ne-count.danger { color: #d14; }

.ne-close { appearance: none; border: none; width: 28px; height: 28px; border-radius: 50%; font-size: 18px; line-height: 1; cursor: pointer; background: transparent; color: inherit; }
.ne-close:hover { background: rgba(0,0,0,.06); }
:global(.dark) .ne-close:hover { background: rgba(255,255,255,.10); }

.ne-editor { position: relative; overflow: auto; padding-bottom: var(--actions-h, 96px); }

.ne-textarea {
  width: 100%;
  border: 1px solid rgba(0,0,0,.08);
  border-radius: 10px;
  padding: 12px;
  font: inherit;
  line-height: 1.6;
  color: inherit;
  background: transparent;
  outline: none;
  resize: none;
  overflow: hidden;
}

.ne-spacer { width: 100%; flex: 0 0 auto; }

/* Tag 面板 */
.ne-tag-panel { position: absolute; left: 8px; bottom: 8px; display: flex; flex-wrap: wrap; gap: 6px; max-width: calc(100% - 16px); }
.ne-tag-item { border: 1px solid rgba(0,0,0,.08); background: rgba(0,0,0,.03); padding: 2px 8px; border-radius: 999px; font-size: 12px; cursor: pointer; }
.ne-tag-item:hover { background: rgba(0,0,0,.06); }
:global(.dark) .ne-tag-item { border-color: rgba(255,255,255,.16); background: rgba(255,255,255,.06); }
:global(.dark) .ne-tag-item:hover { background: rgba(255,255,255,.10); }

/* Action 区域：sticky 吸底 */
.ne-actions { display: grid; grid-auto-flow: column; justify-content: center; align-items: center; gap: 10px; padding-top: 10px; position: sticky; bottom: 0; z-index: 2; background: var(--ne-bg, #fff); padding-bottom: max(10px, env(safe-area-inset-bottom)); box-shadow: 0 -6px 12px rgba(0,0,0,.04); }

.ne-cancel { min-width: 96px; height: 40px; border-radius: 999px; border: 1px solid rgba(0,0,0,.15); background: transparent; color: inherit; cursor: pointer; }
:global(.dark) .ne-cancel { border-color: rgba(255,255,255,.25); }
.ne-cancel:hover { background: rgba(0,0,0,.04); }
:global(.dark) .ne-cancel:hover { background: rgba(255,255,255,.06); }

.ne-submit { min-width: 160px; height: 40px; padding: 0 16px; border-radius: 999px; border: none; cursor: pointer; font: inherit; background: #00b386; color: #fff; }
.ne-submit:disabled { opacity: .6; cursor: not-allowed; }
.ne-submit:hover:enabled { filter: brightness(0.95); }
:global(.dark) .ne-submit { background: #00b386; }

.ne-hint { opacity: .6; font-size: 12px; text-align: center; padding: 8px 0 4px; }
</style>
