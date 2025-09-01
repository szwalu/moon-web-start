<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import EasyMDE from 'easymde'
import 'easymde/dist/easymde.min.css'
import { useSettingStore } from '@/stores/setting'

// --- Props & Emits Definition ---
const props = defineProps({
  modelValue: { type: String, required: true },
})

const emit = defineEmits(['update:modelValue', 'triggerAutoSave'])

// --- Core State Definition ---
const { t } = useI18n()
const settingsStore = useSettingStore()
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const easymde = ref<EasyMDE | null>(null)
let isReadyForAutoSave = false

function initializeEasyMDE(initialValue = '') {
  isReadyForAutoSave = false
  const newEl = textareaRef.value
  if (!newEl || easymde.value)
    return

  easymde.value = new EasyMDE({
    element: newEl,
    initialValue,
    spellChecker: false,
    placeholder: t('notes.content_placeholder'),
    // 简化工具栏，可以按需加回
    toolbar: ['bold', 'italic', '|', 'unordered-list', 'ordered-list', '|', 'preview'],
    status: false,
    // 自动聚焦
    autofocus: true,
  })

  nextTick(applyEditorFontSize)

  const cm = easymde.value.codemirror
  cm.on('change', () => {
    emit('update:modelValue', easymde.value?.value() ?? '')
    if (!isReadyForAutoSave)
      isReadyForAutoSave = true
    else
      emit('triggerAutoSave')
  })
}

function applyEditorFontSize() {
  if (!easymde.value)
    return
  const cmWrapper = easymde.value.codemirror.getWrapperElement()
  cmWrapper.classList.remove('font-size-small', 'font-size-medium', 'font-size-large')
  cmWrapper.classList.add(`font-size-${settingsStore.noteFontSize}`)
}

function destroyEasyMDE() {
  if (easymde.value) {
    easymde.value.toTextArea()
    easymde.value = null
  }
}

onMounted(() => {
  initializeEasyMDE(props.modelValue)
})

onUnmounted(() => {
  destroyEasyMDE()
})

watch(() => props.modelValue, (newValue) => {
  if (easymde.value && newValue !== easymde.value.value())
    easymde.value.value(newValue)
})

watch(() => settingsStore.noteFontSize, () => {
  applyEditorFontSize()
})
</script>

<template>
  <div class="note-editor-container">
    <textarea ref="textareaRef" />
  </div>
</template>

<style scoped>
.note-editor-container {
  /* 核心：作为 flex 子项，填满父容器的可用空间 */
  flex: 1;
  min-height: 0; /* 防止内容溢出时撑破父容器 */
  position: relative; /* 为 EasyMDE 提供定位上下文 */
}
</style>

<style>
/* EasyMDE 全局样式调整 */
.note-editor-container .EasyMDEContainer {
  height: 100%;
  width: 100%;
  border: none;
  display: flex;
  flex-direction: column;
}
.note-editor-container .editor-toolbar {
  flex-shrink: 0;
  border: none;
  border-bottom: 1px solid #e0e0e0;
  background-color: #fff;
}
.dark .note-editor-container .editor-toolbar {
  background: #1e1e1e;
  border-bottom-color: #48484a;
}
.dark .note-editor-container .editor-toolbar a {
  color: #e0e0e0;
}
.dark .note-editor-container .editor-toolbar a.active {
  background: #404040;
}
.note-editor-container .CodeMirror {
  flex: 1;
  min-height: 0;
  background: #fff;
  color: #333;
}
.dark .note-editor-container .CodeMirror {
  background: #1e1e1e;
  color: #e0e0e0;
}
.note-editor-container .CodeMirror-scroll {
  cursor: text;
}
/* 字体大小设置 */
.CodeMirror.font-size-small { font-size: 14px !important; line-height: 1.5; }
.CodeMirror.font-size-medium { font-size: 16px !important; line-height: 1.6; }
.CodeMirror.font-size-large { font-size: 20px !important; line-height: 1.7; }
</style>
