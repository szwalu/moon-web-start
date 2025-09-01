<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
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
const localValue = ref(props.modelValue)

// 父组件更新时同步
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

  // 保证光标始终可见
  await nextTick()
  textareaRef.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

function handleSubmit() {
  emit('submit')
}
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
    <div class="editor-footer">
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
  height: 100dvh; /* 核心：视口高度，键盘弹出时会缩短 */
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
  padding-bottom: 60px; /* 给保存按钮预留空间，避免最后几行被盖住 */
  font-family: inherit;
  line-height: 1.6;
  resize: none;
  overflow-y: auto;
  outline: none;
}

.editor-footer {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 8px 12px;
  background: #fff;
  border-top: 1px solid #ddd;
  display: flex;
  align-items: center;
  justify-content: space-between;
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
