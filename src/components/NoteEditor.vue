<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingStore } from '@/stores/setting'

const props = defineProps({
  modelValue: { type: String, required: true },
  editingNote: { type: Object as () => any | null, default: null },
  isLoading: { type: Boolean, default: false },
  maxNoteLength: { type: Number, default: 3000 },
  lastSavedTime: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'submit', 'triggerAutoSave'])

const { t } = useI18n()
const settingsStore = useSettingStore()

const scrollRef = ref<HTMLElement | null>(null) // 文本滚动容器
const taRef = ref<HTMLTextAreaElement | null>(null)
const footerRef = ref<HTMLElement | null>(null)

const local = ref(props.modelValue)

watch(() => props.modelValue, (v) => {
  if (v !== local.value)
    local.value = v
})

async function onInput(e: Event) {
  const v = (e.target as HTMLTextAreaElement).value
  if (v.length > props.maxNoteLength)
    return
  local.value = v
  emit('update:modelValue', v)
  emit('triggerAutoSave')

  await nextTick()
  // 让当前输入行尽量靠近底部可见
  ensureBottomPadding()
  taRef.value?.scrollIntoView({ block: 'nearest' })
}

function submit() {
  emit('submit')
}

/** iOS 刘海安全区底部像素 */
function getSafeAreaBottom(): number {
  const tmp = document.createElement('div')
  tmp.style.cssText = 'position:fixed;bottom:0;height:0;visibility:hidden;padding-bottom:env(safe-area-inset-bottom)'
  document.body.appendChild(tmp)
  const safe = Number.parseFloat(getComputedStyle(tmp).paddingBottom || '0') || 0
  document.body.removeChild(tmp)
  return safe
}

/** 核心：根据键盘高度抬升 footer，并给滚动容器补底部内边距 */
function applyKeyboardAvoidance() {
  if (!footerRef.value || !scrollRef.value)
    return

  const vv = (window as any).visualViewport
  let keyboard = 0
  if (vv && typeof vv.height === 'number')
    keyboard = Math.max(0, window.innerHeight - vv.height - (vv.offsetTop || 0))

  const safe = getSafeAreaBottom()
  const footerH = footerRef.value.getBoundingClientRect().height

  // 让 footer 真正“悬浮”在键盘上方（以视口为参照）
  footerRef.value.style.bottom = `${keyboard}px`

  // 让内容最后一行别被挡住
  const pad = Math.ceil(footerH + keyboard + safe)
  ;(scrollRef.value as HTMLElement).style.paddingBottom = `${pad}px`
}

/** 兜底：部分安卓机不触发 visualViewport */
function legacyResizeWorkaround() {
  applyKeyboardAvoidance()
}

function ensureBottomPadding() {
  applyKeyboardAvoidance()
}

onMounted(() => {
  // 初次进入：把光标放到末尾，打开键盘，随后计算一次
  requestAnimationFrame(() => {
    if (taRef.value) {
      taRef.value.focus()
      const len = taRef.value.value.length
      taRef.value.selectionStart = taRef.value.selectionEnd = len
    }
    ensureBottomPadding()
  })

  const vv = (window as any).visualViewport
  if (vv && vv.addEventListener) {
    vv.addEventListener('resize', applyKeyboardAvoidance)
    vv.addEventListener('scroll', applyKeyboardAvoidance)
  }
  window.addEventListener('resize', legacyResizeWorkaround)
})

onUnmounted(() => {
  const vv = (window as any).visualViewport
  if (vv && vv.removeEventListener) {
    vv.removeEventListener('resize', applyKeyboardAvoidance)
    vv.removeEventListener('scroll', applyKeyboardAvoidance)
  }
  window.removeEventListener('resize', legacyResizeWorkaround)
})
</script>

<template>
  <!-- 全屏编辑器：固定视口，不再被父层内容挤压 -->
  <section class="editor-screen">
    <div ref="scrollRef" class="editor-scroll">
      <textarea
        ref="taRef"
        v-model="local"
        :placeholder="t('notes.content_placeholder')"
        :style="{ fontSize: `${settingsStore.noteFontSize}px` }"
        class="editor-textarea"
        :disabled="isLoading"
        autocapitalize="sentences"
        autocomplete="off"
        autocorrect="on"
        spellcheck="false"
        inputmode="text"
        enterkeyhint="done"
        @input="onInput"
      />
    </div>

    <!-- 底部操作条：固定在视口（position:fixed），用 JS 动态抬升 -->
    <footer ref="footerRef" class="editor-footer">
      <div class="status">
        <span class="count">
          {{ t('notes.char_count') }}: {{ local.length }}/{{ maxNoteLength }}
        </span>
        <span v-if="lastSavedTime" class="saved">
          💾 {{ t('notes.auto_saved_at') }}: {{ lastSavedTime }}
        </span>
      </div>
      <button
        class="save-btn"
        :disabled="isLoading || !local"
        @click="submit"
      >
        {{ isLoading ? t('notes.saving') : editingNote ? t('notes.update_note') : t('notes.save_note') }}
      </button>
    </footer>
  </section>
</template>

<style scoped>
/* 整个编辑器占满视口，高度用 100dvh 防止 iOS 地址栏抖动 */
.editor-screen{
  position: fixed;
  inset: 0;
  height: 100dvh;
  background: #fff;
  z-index: 1002; /* 高于 overlay(1000) */
  display: flex;
  flex-direction: column;
  max-width: 480px;
  margin: 0 auto;
}

/* 只让这个容器滚动，textarea 不负责滚动 */
.editor-scroll{
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  padding-top: 8px;
  /* padding-bottom 由 JS 动态设置，避免最后一行被挡 */
}

/* 文本域本身不扩高，不设置 min-height，避免初次聚焦把 footer 顶出视口 */
.editor-textarea{
  display: block;
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  line-height: 1.6;
  font-family: inherit;
  /* 不设置固定高度；由外层滚动容器承载滚动 */
}

/* 视口固定 footer（不是容器里的 absolute） */
.editor-footer{
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: 0; /* 将由 JS 动态加上键盘高度 */
  width: 100%;
  max-width: 480px;
  padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
  background: #fff;
  border-top: 1px solid #eaeaea;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 -6px 24px rgba(0,0,0,.06);
}

.status{
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  color: #666;
  font-size: 12px;
}
.status .count{ white-space: nowrap; }
.status .saved{ white-space: nowrap; }

.save-btn{
  margin-left: auto;
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  background: #007aff;
  color: #fff;
  font-size: 14px;
}
.save-btn:disabled{ opacity: .6; }

@media (min-width: 768px){
  .editor-screen{ height: 100vh; }
}
</style>
