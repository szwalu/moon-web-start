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
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const footerRef = ref<HTMLElement | null>(null)

const localValue = ref(props.modelValue)

watch(() => props.modelValue, (val) => {
  if (val !== localValue.value)
    localValue.value = val
})

async function handleInput(e: Event) {
  const val = (e.target as HTMLTextAreaElement).value
  if (val.length > props.maxNoteLength)
    return
  localValue.value = val
  emit('update:modelValue', val)
  emit('triggerAutoSave')

  await nextTick()
  textareaRef.value?.scrollIntoView({ block: 'nearest' })
}

function handleSubmit() {
  emit('submit')
}

function adjustFooterForKeyboard() {
  if (!footerRef.value || !window.visualViewport)
    return
  const layoutHeight = window.innerHeight
  const viewportHeight = window.visualViewport.height
  const keyboardHeight = layoutHeight - viewportHeight
  footerRef.value.style.bottom = `${keyboardHeight}px`
}

onMounted(() => {
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', adjustFooterForKeyboard)
    window.visualViewport.addEventListener('scroll', adjustFooterForKeyboard)
    adjustFooterForKeyboard()
  }
})

onUnmounted(() => {
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', adjustFooterForKeyboard)
    window.visualViewport.removeEventListener('scroll', adjustFooterForKeyboard)
  }
})
</script>

<template>
  <div class="note-editor-mobile">
    <textarea
      ref="textareaRef"
      v-model="localValue"
      :style="{ fontSize: `${settingsStore.noteFontSize}px` }"
      :placeholder="t('notes.content_placeholder')"
      class="editor-textarea"
      :disabled="isLoading"
      @input="handleInput"
    />
    <div ref="footerRef" class="editor-footer">
      <div class="status">
        <span class="char-counter">
          {{ t('notes.char_count') }}: {{ localValue.length }}/{{ maxNoteLength }}
        </span>
        <span v-if="lastSavedTime" class="ml-2">
          💾 {{ t('notes.auto_saved_at') }}: {{ lastSavedTime }}
        </span>
      </div>
      <button
        class="save-btn"
        :disabled="isLoading || !localValue"
        @click="handleSubmit"
      >
        {{ isLoading ? t('notes.saving') : editingNote ? t('notes.update_note') : t('notes.save_note') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.note-editor-mobile {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  background: #fff;
  z-index: 1002;
}

.editor-textarea {
  flex: 1;
  width: 100%;
  border: none;
  padding: 12px;
  padding-bottom: 60px;
  font-family: inherit;
  line-height: 1.6;
  resize: none;
  overflow-y: auto;
  outline: none;
}

.editor-footer {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0; /* 将被 JS 动态调整 */
  padding: 8px 12px;
  background: #fff;
  border-top: 1px solid #ddd;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: bottom 0.15s ease;
}

.char-counter {
  font-size: 12px;
  color: #666;
}

.save-btn {
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  background: #007aff;
  color: #fff;
  font-size: 14px;
}
.save-btn:disabled {
  opacity: 0.6;
}
</style>
