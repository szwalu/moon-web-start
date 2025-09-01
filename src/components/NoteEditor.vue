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

const wrapperRef = ref<HTMLElement | null>(null) // 整个抽屉
const scrollRef = ref<HTMLElement | null>(null) // 文本滚动区（包着 textarea）
const taRef = ref<HTMLTextAreaElement | null>(null)
const footerRef = ref<HTMLElement | null>(null)

const local = ref(props.modelValue)

watch(() => props.modelValue, (v) => {
  if (v !== local.value)
    local.value = v
})

/** 输入时：同步 + 触发父级自动保存 + 保证光标可见 */
async function onInput(e: Event) {
  const v = (e.target as HTMLTextAreaElement).value
  if (v.length > props.maxNoteLength)
    return
  local.value = v
  emit('update:modelValue', v)
  emit('triggerAutoSave')

  // 让输入行别被底部占位区挡住
  await nextTick()
  // 浏览器本身会尽力让光标可见；我们再确保滚动容器底部预留足够内边距
  ensureBottomPadding()
}

/** 点击保存 */
function submit() {
  emit('submit')
}

/** 计算键盘高度并抬升底部操作栏，同时给内容区补足底部内边距 */
function applyKeyboardAvoidance() {
  if (!footerRef.value || !scrollRef.value || !wrapperRef.value)
    return

  const vv = (window as any).visualViewport
  let keyboard = 0
  if (vv && typeof vv.height === 'number') {
    // 键盘高度 ~= 布局视口高度 - 可视视口高度
    keyboard = Math.max(0, window.innerHeight - vv.height - (vv.offsetTop || 0))
  }

  // 记录 footer 高度（初次/窗口变化时测量）
  const footerH = footerRef.value.getBoundingClientRect().height

  // 把操作栏抬到键盘上方（向上移动 keyboard px）
  footerRef.value.style.transform = `translateY(${-keyboard}px)`

  // 给内容区预留底部空间（避免最后几行被 footer + 键盘 + 安全区挡住）
  const safe = getSafeAreaBottom()
  const pad = Math.ceil(footerH + keyboard + safe)
  ;(scrollRef.value as HTMLElement).style.paddingBottom = `${pad}px`

  // 让抽屉高度使用 100dvh，兼容旧设备时 fallback
  ;(wrapperRef.value as HTMLElement).style.height = 'min(85dvh, 85vh)'
}

/** 在没有 visualViewport 的设备上，也尽量更新一次 */
function legacyResizeWorkaround() {
  applyKeyboardAvoidance()
}

/** iOS 刘海安全区底部 */
function getSafeAreaBottom(): number {
  // 会返回 0~常见 34px（iPhoneX+）
  const tmp = document.createElement('div')
  tmp.style.cssText = 'position:fixed;bottom:0;height:0;visibility:hidden;padding-bottom:env(safe-area-inset-bottom)'
  document.body.appendChild(tmp)
  const safe = Number.parseFloat(getComputedStyle(tmp).paddingBottom || '0') || 0
  document.body.removeChild(tmp)
  return safe
}

/** 根据 footer 实际高度、键盘高度，补充内容区底部内边距 */
function ensureBottomPadding() {
  applyKeyboardAvoidance()
}

onMounted(() => {
  // 初始测量一次
  applyKeyboardAvoidance()

  const vv = (window as any).visualViewport
  if (vv && vv.addEventListener) {
    vv.addEventListener('resize', applyKeyboardAvoidance)
    vv.addEventListener('scroll', applyKeyboardAvoidance)
  }
  // 兜底：窗口 resize 也调用一次（某些安卓机型仅触发这里）
  window.addEventListener('resize', legacyResizeWorkaround)

  // 初次进入编辑时，滚到内容最后一行（常见移动端行为）
  requestAnimationFrame(() => {
    if (taRef.value) {
      taRef.value.focus()
      taRef.value.selectionStart = taRef.value.selectionEnd = taRef.value.value.length
    }
    ensureBottomPadding()
  })
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
  <!-- 抽屉：放在 overlay 之上但不占满整屏，上方仍有灰幕可点击关闭 -->
  <section ref="wrapperRef" class="sheet">
    <div class="sheet__grab" />

    <div ref="scrollRef" class="sheet__scroll">
      <textarea
        ref="taRef"
        v-model="local"
        :placeholder="t('notes.content_placeholder')"
        :style="{ fontSize: `${settingsStore.noteFontSize}px` }"
        class="sheet__textarea"
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

    <footer ref="footerRef" class="sheet__footer">
      <div class="sheet__status">
        <span class="count">
          {{ t('notes.char_count') }}: {{ local.length }}/{{ maxNoteLength }}
        </span>
        <span v-if="lastSavedTime" class="saved">
          💾 {{ t('notes.auto_saved_at') }}: {{ lastSavedTime }}
        </span>
      </div>
      <button
        class="sheet__save"
        :disabled="isLoading || !local"
        @click="submit"
      >
        {{ isLoading ? t('notes.saving') : editingNote ? t('notes.update_note') : t('notes.save_note') }}
      </button>
    </footer>
  </section>
</template>

<style scoped>
/* 抽屉整体（底部 85dvh），顶部留出灰幕可点 overlay 关闭 */
.sheet{
  position: fixed;
  left: 0; right: 0; bottom: 0;
  margin: 0 auto;
  max-width: 480px;
  height: min(85dvh, 85vh);
  background: #fff;
  border-radius: 12px 12px 0 0;
  box-shadow: 0 -6px 24px rgba(0,0,0,.12);
  display: flex;
  flex-direction: column;
  z-index: 1002; /* 高于 overlay(1000) */
}

.sheet__grab{
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sheet__grab::after{
  content: "";
  width: 42px; height: 4px;
  border-radius: 999px;
  background: #ddd;
}

.sheet__scroll{
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 12px;
}

/* 让文本区填满滚动区 */
.sheet__textarea{
  display: block;
  width: 100%;
  min-height: 60vh; /* 初始给个合适高度；实际滚动在 .sheet__scroll 上 */
  border: none;
  outline: none;
  resize: none;
  padding: 8px 0;
  font-family: inherit;
  line-height: 1.6;
  background: transparent;
  /* 关键：底部内边距由 JS 动态补足，避免被 footer/键盘/安全区遮挡 */
  padding-bottom: 0;
  /* iOS 点击态更自然 */
  -webkit-tap-highlight-color: transparent;
}

/* 底部操作栏：独立层，真实“悬浮” */
.sheet__footer{
  position: absolute;
  left: 0; right: 0; bottom: 0;
  padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
  background: #fff;
  border-top: 1px solid #eaeaea;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: transform .15s ease; /* 抬升时更平滑 */
}

.sheet__status{
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  color: #666;
  font-size: 12px;
}
.sheet__status .count{white-space: nowrap;}
.sheet__status .saved{white-space: nowrap;}

.sheet__save{
  margin-left: auto;
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  background: #007aff;
  color: #fff;
  font-size: 14px;
}
.sheet__save:disabled{ opacity: .6; }

@media (min-width: 768px){
  .sheet{
    height: 70vh;
    max-height: 640px;
  }
  .sheet__textarea{ min-height: 0; }
}
</style>
